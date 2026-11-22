/**
 * `taro board`: the one board from any terminal, with no daemon (`shared/board-text.ts` draws it). Reads the
 * tracker's ticket files and, when present, the Paseo plugin's live list (`live.json`) and `decisions.json`,
 * never writing any of them. `--watch`
 * reprints whenever one of those files changes, until SIGINT.
 *
 * Runs under plain `node` type stripping (the `taro` command): erasable TypeScript only, `.ts` import
 * extensions, Node builtins only, nothing of Paseo's or zod.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { boardText, buildBoard, type Board, type StateFile } from "../shared/board-text.ts";
import { readAgents, readCards } from "../shared/tracker-cards.ts";
import type { TicketStore } from "./ticket-store.ts";

/** How often `--watch` looks for a changed file. */
const WATCH_POLL_MS = 1000;
/** `--watch` also looks again this often with no file changed: a list can go stale, a card a day old, by the clock alone. */
const WATCH_REFRESH_MS = 60_000;

export interface BoardIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
}

export interface BoardOptions {
  store: TicketStore;
  trackerPath: string;
  project: string | null;
  json: boolean;
  watch: boolean;
  /** Clears the terminal before each reprint (a terminal, not a pipe). */
  clear?: boolean;
  /** How often `--watch` looks again with no file changed (tests shorten it). */
  refreshMs?: number;
  /** Ends `--watch`; the command line aborts it on SIGINT. */
  signal?: AbortSignal;
}

/** The plugin's state folder, by the rule of `server/data-dir.ts` (`statePath`), read from the given environment. */
export function paseoStateDirectory(env: BoardIo["env"]): string {
  const home = env.PASEO_HOME === undefined || env.PASEO_HOME === "" ? join(homedir(), ".paseo") : env.PASEO_HOME;
  return join(home, "plugin-data", "taro", "state");
}

async function readState(path: string): Promise<StateFile> {
  let text: string;
  let writtenAt: string;
  try {
    const [content, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    text = content;
    writtenAt = info.mtime.toISOString();
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", reason: `${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    return { kind: "read", value: JSON.parse(text), writtenAt };
  } catch {
    return { kind: "unreadable", reason: `${path} is not JSON` };
  }
}

interface Snapshot {
  board: Board;
  text: string;
  problems: string[];
  /** What `--watch` compares: the board without Paseo's "as of" time, which the plugin's heartbeat renews every minute. */
  key: string;
}

async function snapshot(options: BoardOptions, io: BoardIo): Promise<Snapshot> {
  const listed = await options.store.list();
  const problems = listed.problems.map((problem) => `${problem.file}:${problem.line}: ${problem.message}`);
  const tickets = await Promise.all(
    listed.tickets.map(async (summary) => {
      const text = await readFile(join(options.trackerPath, summary.file), "utf8").catch(() => "");
      const cards = readCards(text);
      const agents = readAgents(text);
      for (const problem of [...cards.problems, ...agents.problems]) problems.push(`${summary.file}:${problem.line}: ${problem.message} (${summary.id})`);
      return { id: summary.id, title: summary.title, status: summary.status, cards: cards.items, agents: agents.items };
    }),
  );
  const directory = paseoStateDirectory(io.env);
  const [decisions, live] = await Promise.all([readState(join(directory, "decisions.json")), readState(join(directory, "live.json"))]);
  const now = Date.now();
  const { board, paseoNote } = buildBoard({ project: options.project, tickets, decisions, live, now });
  const text = boardText(board, {
    project: options.project,
    trackerPath: options.trackerPath,
    paseoNote,
    now,
  });
  if (options.json && paseoNote !== null) problems.push(paseoNote);
  return { board, text, problems, key: JSON.stringify({ board: { ...board, paseo: board.paseo === null ? null : { ...board.paseo, asOf: null } }, paseoNote }) };
}

/** What `--watch` compares: every ticket file's and state file's size and change time. */
async function signature(options: BoardOptions, io: BoardIo): Promise<string> {
  const directory = join(options.trackerPath, "tickets");
  const names = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".md")).sort();
  const files = [...names.map((name) => join(directory, name)), join(paseoStateDirectory(io.env), "decisions.json"), join(paseoStateDirectory(io.env), "live.json")];
  const stamps = await Promise.all(files.map(async (file) => {
    const info = await stat(file).catch(() => null);
    return info === null ? `${file}:-` : `${file}:${info.size}:${info.mtimeMs}`;
  }));
  return stamps.join("\n");
}

function print(shot: Snapshot, options: BoardOptions, io: BoardIo): void {
  if (options.clear === true) io.stdout("\u001b[2J\u001b[H");
  io.stdout(options.json ? `${JSON.stringify(shot.board, null, 2)}\n` : shot.text);
  for (const problem of shot.problems) io.stderr(`${problem}\n`);
}

export async function boardCommand(options: BoardOptions, io: BoardIo): Promise<number> {
  const first = await snapshot(options, io);
  print(first, options, io);
  if (!options.watch) return 0;
  let shown = first.key;
  const signal = options.signal;
  // A function, so the check reads the signal afresh after each wait.
  const stopped = (): boolean => signal?.aborted === true;
  let last = await signature(options, io);
  let lastLooked = Date.now();
  while (!stopped()) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, WATCH_POLL_MS);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
    if (stopped()) break;
    const current = await signature(options, io);
    // No file changed: look again only when the refresh is due, and print only if what is drawn differs.
    if (current === last && Date.now() - lastLooked < (options.refreshMs ?? WATCH_REFRESH_MS)) continue;
    last = current;
    lastLooked = Date.now();
    // A file renewed with nothing new in it (the plugin's heartbeat) is not a change worth printing.
    const shot = await snapshot(options, io);
    if (shot.key === shown) continue;
    shown = shot.key;
    print(shot, options, io);
  }
  return 0;
}
