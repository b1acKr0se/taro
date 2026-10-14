/**
 * The tracker's one read and write path (TR-081 spec S1, S4–S6): `tickets/<ID>.md` files and
 * `tracker.json` under a tracker directory. Every write takes the tracker lock (`.taro/lock`), reads
 * the current file, applies the change and replaces the file by temp file + fsync + rename, so the
 * daemon and every `taro` command can write at once without losing a record. Reads are async and
 * cache summaries only, re-reading a file only when its mtime or size changed.
 *
 * Runs under plain `node` type stripping too (the `taro` command): erasable TypeScript only, `.ts`
 * import extensions, Node builtins only.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

import {
  isTicketStatus,
  parseTicket,
  serializeTicket,
  summaryOf,
  timestampOf,
  TICKET_PRIORITIES,
  withNote,
  type Ticket,
  type TicketPriority,
  type TicketProblem,
  type TicketStatus,
  type TicketSummary,
} from "../shared/ticket-format.ts";

export interface TrackerFile {
  schema: number;
  prefix: string;
  padding: number;
  lastId: number;
  lastChild: Record<string, number>;
}

export interface CreateTicketInput {
  title: string;
  description?: string;
  labels?: string[];
  parent?: string | null;
  dependsOn?: string[];
  priority?: TicketPriority | null;
  status?: TicketStatus;
}

export interface TicketChanges {
  title?: string;
  status?: TicketStatus;
  description?: string;
  plan?: string;
  finalSummary?: string;
  priority?: TicketPriority | null;
  addLabels?: string[];
  removeLabels?: string[];
  addDependencies?: string[];
  appendNotes?: string[];
  checkCriteria?: number[];
  uncheckCriteria?: number[];
}

export interface TicketView {
  ticket: Ticket;
  revision: string;
  file: string;
  subtasks: TicketSummary[];
}

export interface TicketList {
  tickets: TicketSummary[];
  problems: TicketProblem[];
}

export interface StoreOptions {
  /** How long a write waits for the lock before failing (spec: 30 s). */
  lockTimeoutMs?: number;
  /** The clock stamped into `created` and `updated`. */
  now?: () => Date;
  /** Prefix for a tracker without tracker.json and without ticket files to infer it from. */
  prefix?: string;
  /** File reads, injectable so tests can count them. */
  readFile?: (path: string) => Promise<string>;
}

/** What `list()` keeps per file between calls: never a body. */
export interface CacheEntry {
  mtimeMs: number;
  size: number;
  summary: TicketSummary | null;
  problems: TicketProblem[];
}

export interface TicketStore {
  list(): Promise<TicketList>;
  view(id: string): Promise<TicketView>;
  search(query: string): Promise<TicketSummary[]>;
  create(input: CreateTicketInput): Promise<Ticket>;
  edit(id: string, changes: TicketChanges, options?: { revision?: string }): Promise<Ticket>;
  appendNote(id: string, record: string): Promise<Ticket>;
  forget(file?: string): void;
  /** The cached entries by file name, for tests and diagnostics. */
  cacheEntries(): ReadonlyMap<string, CacheEntry>;
}

export class RevisionConflict extends Error {
  readonly id: string;
  readonly expected: string;
  readonly current: string;
  constructor(id: string, expected: string, current: string) {
    super(`${id} changed since revision ${expected}; its current revision is ${current}. View it again and redo the change.`);
    this.name = "RevisionConflict";
    this.id = id;
    this.expected = expected;
    this.current = current;
  }
}

export class TicketNotFound extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`Ticket ${id} does not exist.`);
    this.name = "TicketNotFound";
    this.id = id;
  }
}

export class TicketInvalid extends Error {
  readonly problems: TicketProblem[];
  constructor(problems: TicketProblem[]) {
    super(problems.map((problem) => `${problem.file}:${problem.line}: ${problem.message}`).join("\n"));
    this.name = "TicketInvalid";
    this.problems = problems;
  }
}

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const OWNERLESS_LOCK_STALE_MS = 10_000;
const STRAY_TEMP_MS = 60_000;
const TRACKER_SCHEMA = 1;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+(\.\d+)*$/;
const TICKET_FILE = /^[^.].*\.md$/;
const TEMP_FILE = /\.tmp$/;

function isMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ENOENT";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive, owned by someone else.
    return (error as { code?: string }).code !== "ESRCH";
  }
}

function tempSuffix(): string {
  return `${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
}

/** Writes beside the target, fsyncs and renames over it, so a reader sees the old file or the new one. */
async function replaceFile(directory: string, tempName: string, target: string, text: string): Promise<void> {
  const temp = join(directory, tempName);
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new Error(`"${id}" is not a ticket id (like TR-081 or TR-081.01).`);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function createTicketStore(trackerPath: string, options: StoreOptions = {}): TicketStore {
  const ticketsDirectory = join(trackerPath, "tickets");
  const taroDirectory = join(trackerPath, ".taro");
  const lockDirectory = join(taroDirectory, "lock");
  const trackerFile = join(trackerPath, "tracker.json");
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const read = options.readFile ?? ((path: string) => readFile(path, "utf8"));
  const host = hostname();
  const cache = new Map<string, CacheEntry>();
  // Writes from this process queue here rather than polling their own lock.
  let writeQueue: Promise<unknown> = Promise.resolve();

  const fileOf = (id: string): string => join(ticketsDirectory, `${id}.md`);
  const relativeFile = (name: string): string => `tickets/${name}`;

  async function readOwner(): Promise<{ pid: number; host: string; token: string } | null> {
    try {
      const owner = JSON.parse(await readFile(join(lockDirectory, "owner.json"), "utf8")) as unknown;
      if (typeof owner !== "object" || owner === null) return null;
      const { pid, host: ownerHost, token } = owner as Record<string, unknown>;
      if (typeof pid !== "number" || typeof ownerHost !== "string") return null;
      return { pid, host: ownerHost, token: typeof token === "string" ? token : "" };
    } catch {
      return null;
    }
  }

  /** Moves the lock aside and removes it, then checks it was the one judged stale; a live lock taken meanwhile goes back. */
  async function breakLock(expectedToken: string | null): Promise<void> {
    const aside = join(taroDirectory, `lock.broken.${tempSuffix()}`);
    try {
      await rename(lockDirectory, aside);
    } catch {
      return;
    }
    let token: string | null = null;
    try {
      const owner = JSON.parse(await readFile(join(aside, "owner.json"), "utf8")) as { token?: unknown };
      token = typeof owner.token === "string" ? owner.token : "";
    } catch {
      token = null;
    }
    if (token !== expectedToken) {
      await rename(aside, lockDirectory).catch(() => undefined);
      return;
    }
    await rm(aside, { recursive: true, force: true });
  }

  async function acquireLock(): Promise<string> {
    await mkdir(taroDirectory, { recursive: true });
    const token = randomBytes(8).toString("hex");
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      try {
        await mkdir(lockDirectory);
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        await waitOrBreak(started, attempt);
        continue;
      }
      try {
        const owner = JSON.stringify({ pid: process.pid, host, at: timestampOf(new Date()), token });
        await replaceFile(lockDirectory, `.owner.${tempSuffix()}`, join(lockDirectory, "owner.json"), owner);
        return token;
      } catch (error) {
        await rm(lockDirectory, { recursive: true, force: true });
        throw error;
      }
    }
  }

  /** The lock is taken: break it when its holder is gone, otherwise wait with backoff or fail after the timeout. */
  async function waitOrBreak(started: number, attempt: number): Promise<void> {
    const owner = await readOwner();
    if (owner !== null && owner.host === host && !processIsAlive(owner.pid)) {
      await breakLock(owner.token);
      return;
    }
    if (owner === null) {
      const lockStat = await stat(lockDirectory).catch(() => null);
      if (lockStat !== null && Date.now() - lockStat.mtimeMs > OWNERLESS_LOCK_STALE_MS) {
        await breakLock(null);
        return;
      }
    }
    if (Date.now() - started >= lockTimeoutMs) {
      const holder = owner === null ? "an unknown process" : `pid ${owner.pid} on ${owner.host}`;
      throw new Error(`The tracker is locked by ${holder} (${lockDirectory}); gave up after ${lockTimeoutMs} ms.`);
    }
    const backoff = Math.min(250, 25 * 2 ** Math.min(attempt, 4));
    await delay(backoff / 2 + Math.random() * (backoff / 2));
  }

  async function releaseLock(token: string): Promise<void> {
    const owner = await readOwner();
    if (owner === null || owner.pid !== process.pid || owner.host !== host || owner.token !== token) return;
    await rm(lockDirectory, { recursive: true, force: true });
  }

  async function removeStrayTemps(directory: string): Promise<void> {
    const names = await readdir(directory).catch(() => [] as string[]);
    await Promise.all(
      names
        .filter((name) => TEMP_FILE.test(name))
        .map(async (name) => {
          const path = join(directory, name);
          const fileStat = await stat(path).catch(() => null);
          if (fileStat !== null && fileStat.isFile() && Date.now() - fileStat.mtimeMs > STRAY_TEMP_MS) {
            await unlink(path).catch(() => undefined);
          }
        }),
    );
  }

  /** The one write path: lock, sweep stray temp files, run the change, unlock. */
  function locked<T>(work: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const token = await acquireLock();
      try {
        await removeStrayTemps(ticketsDirectory);
        await removeStrayTemps(taroDirectory);
        return await work();
      } finally {
        await releaseLock(token);
      }
    };
    const result = writeQueue.then(run, run);
    writeQueue = result.catch(() => undefined);
    return result;
  }

  async function writeTicket(ticket: Ticket): Promise<void> {
    await mkdir(ticketsDirectory, { recursive: true });
    await replaceFile(ticketsDirectory, `.${ticket.id}.${tempSuffix()}`, fileOf(ticket.id), serializeTicket(ticket));
    cache.delete(`${ticket.id}.md`);
  }

  async function readTicket(id: string): Promise<{ ticket: Ticket; revision: string }> {
    assertId(id);
    let text: string;
    try {
      text = await read(fileOf(id));
    } catch (error) {
      if (isMissing(error)) throw new TicketNotFound(id);
      throw error;
    }
    const parsed = parseTicket(text, relativeFile(`${id}.md`));
    if (!parsed.ok) throw new TicketInvalid(parsed.problems);
    return { ticket: parsed.ticket, revision: parsed.revision };
  }

  async function ticketNames(): Promise<string[]> {
    try {
      return (await readdir(ticketsDirectory)).filter((name) => TICKET_FILE.test(name));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async function readTracker(names: readonly string[]): Promise<TrackerFile> {
    let text: string | null = null;
    try {
      text = await readFile(trackerFile, "utf8");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (text !== null) {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error(`${trackerFile} is not valid JSON; fix it by hand (taro ticket check).`);
      }
      const tracker = value as Partial<TrackerFile>;
      if (typeof tracker.prefix !== "string" || typeof tracker.lastId !== "number") {
        throw new Error(`${trackerFile} needs a "prefix" string and a "lastId" number.`);
      }
      return {
        ...(tracker as TrackerFile),
        schema: tracker.schema ?? TRACKER_SCHEMA,
        padding: typeof tracker.padding === "number" ? tracker.padding : 3,
        lastChild: typeof tracker.lastChild === "object" && tracker.lastChild !== null ? tracker.lastChild : {},
      };
    }
    // No tracker.json yet: infer the prefix and padding from the files; lastId then comes from the file scan.
    const sample = names.map((name) => /^([A-Za-z][A-Za-z0-9]*)-(\d+)\.md$/.exec(name)).find((match) => match !== null);
    return {
      schema: TRACKER_SCHEMA,
      prefix: sample?.[1] ?? options.prefix ?? "TR",
      padding: sample?.[2]?.length ?? 3,
      lastId: 0,
      lastChild: {},
    };
  }

  function nextId(tracker: TrackerFile, names: readonly string[], parent: string | null): string {
    if (parent === null) {
      const pattern = new RegExp(`^${tracker.prefix}-(\\d+)\\.md$`);
      const highest = Math.max(tracker.lastId, ...names.map((name) => Number(pattern.exec(name)?.[1] ?? 0)));
      tracker.lastId = highest + 1;
      return `${tracker.prefix}-${String(highest + 1).padStart(tracker.padding, "0")}`;
    }
    const escaped = parent.split(".").join("\\.");
    const pattern = new RegExp(`^${escaped}\\.(\\d+)\\.md$`);
    const highest = Math.max(tracker.lastChild[parent] ?? 0, ...names.map((name) => Number(pattern.exec(name)?.[1] ?? 0)));
    tracker.lastChild = { ...tracker.lastChild, [parent]: highest + 1 };
    return `${parent}.${String(highest + 1).padStart(2, "0")}`;
  }

  function validateTitle(title: string): void {
    if (title.trim() === "") throw new Error("A ticket needs a non-empty title.");
  }

  function validateStatus(status: string): void {
    if (!isTicketStatus(status)) throw new Error(`"${status}" is not a ticket status.`);
  }

  function validatePriority(priority: TicketPriority | null): void {
    if (priority !== null && !(TICKET_PRIORITIES as readonly string[]).includes(priority)) {
      throw new Error(`"${priority}" is not a priority (high, medium, low).`);
    }
  }

  function setCriteria(ticket: Ticket, indexes: readonly number[], checked: boolean): void {
    for (const index of indexes) {
      const criterion = ticket.criteria.find((entry) => entry.index === index);
      if (criterion === undefined) throw new Error(`${ticket.id} has no acceptance criterion #${index}.`);
      criterion.checked = checked;
    }
  }

  function applyChanges(ticket: Ticket, changes: TicketChanges): void {
    if (changes.title !== undefined) {
      validateTitle(changes.title);
      ticket.title = changes.title;
    }
    if (changes.status !== undefined) {
      validateStatus(changes.status);
      ticket.status = changes.status;
    }
    if (changes.priority !== undefined) {
      validatePriority(changes.priority);
      ticket.priority = changes.priority;
    }
    if (changes.description !== undefined) ticket.description = changes.description;
    if (changes.plan !== undefined) ticket.plan = changes.plan;
    if (changes.finalSummary !== undefined) ticket.finalSummary = changes.finalSummary;
    if (changes.addLabels !== undefined) ticket.labels = unique([...ticket.labels, ...changes.addLabels]);
    if (changes.removeLabels !== undefined) {
      const removed = new Set(changes.removeLabels);
      ticket.labels = ticket.labels.filter((label) => !removed.has(label));
    }
    if (changes.addDependencies !== undefined) ticket.dependsOn = unique([...ticket.dependsOn, ...changes.addDependencies]);
    if (changes.checkCriteria !== undefined) setCriteria(ticket, changes.checkCriteria, true);
    if (changes.uncheckCriteria !== undefined) setCriteria(ticket, changes.uncheckCriteria, false);
    for (const record of changes.appendNotes ?? []) ticket.notes = withNote(ticket.notes, record);
  }

  async function list(): Promise<TicketList> {
    const names = await ticketNames();
    const present = new Set(names);
    for (const name of cache.keys()) {
      if (!present.has(name)) cache.delete(name);
    }
    await Promise.all(
      names.map(async (name) => {
        const path = join(ticketsDirectory, name);
        const fileStat = await stat(path).catch(() => null);
        if (fileStat === null || !fileStat.isFile()) {
          cache.delete(name);
          return;
        }
        const cached = cache.get(name);
        if (cached !== undefined && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) return;
        let text: string;
        try {
          text = await read(path);
        } catch (error) {
          if (isMissing(error)) {
            cache.delete(name);
            return;
          }
          throw error;
        }
        const parsed = parseTicket(text, relativeFile(name));
        cache.set(name, {
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
          summary: parsed.ok ? summaryOf(parsed.ticket, parsed.revision, relativeFile(name)) : null,
          problems: parsed.ok ? [] : parsed.problems,
        });
      }),
    );
    const tickets: TicketSummary[] = [];
    const problems: TicketProblem[] = [];
    for (const entry of cache.values()) {
      if (entry.summary !== null) tickets.push(entry.summary);
      problems.push(...entry.problems);
    }
    tickets.sort((left, right) => compareIds(left.id, right.id));
    problems.sort((left, right) => compareIds(left.file, right.file) || left.line - right.line);
    return { tickets, problems };
  }

  async function view(id: string): Promise<TicketView> {
    const { ticket, revision } = await readTicket(id);
    const { tickets } = await list();
    return {
      ticket,
      revision,
      file: relativeFile(`${id}.md`),
      subtasks: tickets.filter((summary) => summary.parent === id),
    };
  }

  async function search(query: string): Promise<TicketSummary[]> {
    const needle = query.toLowerCase();
    const names = await ticketNames();
    const found: TicketSummary[] = [];
    await Promise.all(
      names.map(async (name) => {
        let text: string;
        try {
          text = await read(join(ticketsDirectory, name));
        } catch (error) {
          if (isMissing(error)) return;
          throw error;
        }
        const parsed = parseTicket(text, relativeFile(name));
        if (!parsed.ok) return;
        const { ticket } = parsed;
        const haystack = [ticket.id, ticket.title, ticket.description, ticket.plan, ticket.notes, ticket.finalSummary];
        if (haystack.some((field) => field.toLowerCase().includes(needle))) {
          found.push(summaryOf(ticket, parsed.revision, relativeFile(name)));
        }
      }),
    );
    return found.sort((left, right) => compareIds(left.id, right.id));
  }

  async function create(input: CreateTicketInput): Promise<Ticket> {
    validateTitle(input.title);
    validateStatus(input.status ?? "Backlog");
    validatePriority(input.priority ?? null);
    const parent = input.parent ?? null;
    if (parent !== null) assertId(parent);
    return locked(async () => {
      await mkdir(ticketsDirectory, { recursive: true });
      const names = await ticketNames();
      if (parent !== null && !names.includes(`${parent}.md`)) throw new TicketNotFound(parent);
      const tracker = await readTracker(names);
      const id = nextId(tracker, names, parent);
      const stamp = timestampOf(now());
      const ticket: Ticket = {
        id,
        title: input.title,
        status: input.status ?? "Backlog",
        priority: input.priority ?? null,
        labels: unique(input.labels ?? []),
        parent,
        dependsOn: unique(input.dependsOn ?? []),
        created: stamp,
        updated: stamp,
        description: input.description ?? "",
        plan: "",
        criteria: [],
        notes: "",
        finalSummary: "",
        extra: {},
      };
      // tracker.json first: a crash between the two writes skips an id rather than reusing one.
      await replaceFile(taroDirectory, `tracker.json.${tempSuffix()}`, trackerFile, `${JSON.stringify(tracker)}\n`);
      await writeTicket(ticket);
      return ticket;
    });
  }

  async function edit(id: string, changes: TicketChanges, editOptions: { revision?: string } = {}): Promise<Ticket> {
    assertId(id);
    return locked(async () => {
      const { ticket, revision } = await readTicket(id);
      if (editOptions.revision !== undefined && editOptions.revision !== revision) {
        throw new RevisionConflict(id, editOptions.revision, revision);
      }
      applyChanges(ticket, changes);
      ticket.updated = timestampOf(now());
      await writeTicket(ticket);
      return ticket;
    });
  }

  async function appendNote(id: string, record: string): Promise<Ticket> {
    if (record.trim() === "") throw new Error("A note needs some text.");
    return edit(id, { appendNotes: [record] });
  }

  function forget(file?: string): void {
    if (file === undefined) {
      cache.clear();
      return;
    }
    const slash = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
    cache.delete(file.slice(slash + 1));
  }

  return { list, view, search, create, edit, appendNote, forget, cacheEntries: () => cache };
}
