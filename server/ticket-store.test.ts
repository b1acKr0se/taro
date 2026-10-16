import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseTicket, serializeTicket, type Ticket } from "../shared/ticket-format";
import { createTicketStore, RevisionConflict, TicketNotFound, type StoreOptions } from "./ticket-store";

const run = promisify(execFile);
const STORE_MODULE = resolve(import.meta.dirname, "ticket-store.ts");
const FIXED_NOW = new Date("2026-10-14T16:20:31.123Z");

let tracker: string;

beforeEach(() => {
  tracker = mkdtempSync(join(tmpdir(), "taro-store-"));
});

afterEach(() => {
  rmSync(tracker, { recursive: true, force: true });
});

function store(options: StoreOptions = {}) {
  return createTicketStore(tracker, { now: () => FIXED_NOW, ...options });
}

function ticketPath(id: string): string {
  return join(tracker, "tickets", `${id}.md`);
}

async function writeTicketFile(overrides: Partial<Ticket> & { id: string }): Promise<void> {
  const ticket: Ticket = {
    title: `Ticket ${overrides.id}`,
    status: "Queued",
    priority: null,
    labels: [],
    parent: null,
    dependsOn: [],
    created: "2026-10-01T10:00:00Z",
    updated: "2026-10-01T10:00:00Z",
    description: "",
    plan: "",
    criteria: [],
    notes: "",
    finalSummary: "",
    extra: {},
    ...overrides,
  };
  await mkdir(join(tracker, "tickets"), { recursive: true });
  await writeFile(ticketPath(ticket.id), serializeTicket(ticket));
}

/** Runs `script` in a separate `node` process with the store module imported as `createTicketStore`. */
function inNode(script: string): Promise<{ stdout: string; stderr: string }> {
  const code = `import { createTicketStore } from ${JSON.stringify(STORE_MODULE)};\n${script}`;
  return run(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, TRACKER: tracker }, timeout: 60_000 });
}

function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  return child.pid;
}

describe("ticket store", () => {
  it("runs under plain node type stripping: creates and views a ticket", async () => {
    const { stdout } = await inNode(`
      const store = createTicketStore(process.env.TRACKER);
      const created = await store.create({ title: "From node", description: "body $&" });
      const viewed = await store.view(created.id);
      console.log(JSON.stringify({ id: viewed.ticket.id, description: viewed.ticket.description }));
    `);
    expect(JSON.parse(stdout)).toEqual({ id: "TR-001", description: "body $&" });
  });

  it("creates a ticket, stamps created and updated, and views it", async () => {
    const tickets = store();
    const created = await tickets.create({
      title: 'Quotes "and": colons\nand a newline',
      description: "Some text",
      labels: ["needs review", "two words"],
      dependsOn: ["TR-074"],
      priority: "high",
      status: "Ready",
    });
    expect(created).toMatchObject({ id: "TR-001", created: "2026-10-14T16:20:31Z", updated: "2026-10-14T16:20:31Z" });
    const viewed = await tickets.view("TR-001");
    expect(viewed.ticket).toEqual(created);
    expect(viewed.ticket.labels).toEqual(["needs review", "two words"]);
    expect(viewed.ticket.title).toBe('Quotes "and": colons\nand a newline');
    expect(viewed.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(viewed.file).toBe("tickets/TR-001.md");
  });

  it("rejects an empty title, an unknown status and a missing parent", async () => {
    const tickets = store();
    await expect(tickets.create({ title: "  " })).rejects.toThrow(/non-empty title/);
    await expect(tickets.create({ title: "x", status: "Doing" as never })).rejects.toThrow(/not a ticket status/);
    await expect(tickets.create({ title: "x", parent: "TR-009" })).rejects.toBeInstanceOf(TicketNotFound);
  });

  describe("edit", () => {
    it("applies every kind of change in one write", async () => {
      await writeTicketFile({
        id: "TR-001",
        labels: ["a", "b"],
        criteria: [
          { index: 1, text: "one", checked: false },
          { index: 2, text: "two", checked: true },
        ],
      });
      const tickets = store();
      const edited = await tickets.edit("TR-001", {
        title: "New title",
        status: "In Progress",
        description: "desc $1",
        plan: "plan",
        finalSummary: "done",
        priority: "low",
        addLabels: ["c", "a"],
        removeLabels: ["b"],
        addDependencies: ["TR-002", "TR-002"],
        appendNotes: ["first\n\n", "second"],
        checkCriteria: [1],
        uncheckCriteria: [2],
      });
      const { ticket } = await tickets.view("TR-001");
      expect(ticket).toEqual(edited);
      expect(ticket).toMatchObject({
        title: "New title",
        status: "In Progress",
        description: "desc $1",
        plan: "plan",
        finalSummary: "done",
        priority: "low",
        labels: ["a", "c"],
        dependsOn: ["TR-002"],
        notes: "first\n\nsecond",
        updated: "2026-10-14T16:20:31Z",
        created: "2026-10-01T10:00:00Z",
      });
      expect(ticket.criteria.map((criterion) => criterion.checked)).toEqual([true, false]);
    });

    it("checking a criterion index that does not exist is an error and writes nothing", async () => {
      await writeTicketFile({ id: "TR-001", criteria: [{ index: 1, text: "one", checked: false }] });
      const before = await readFile(ticketPath("TR-001"), "utf8");
      await expect(store().edit("TR-001", { checkCriteria: [3] })).rejects.toThrow("TR-001 has no acceptance criterion #3");
      expect(await readFile(ticketPath("TR-001"), "utf8")).toBe(before);
    });

    it("editing a missing ticket is an error naming the id", async () => {
      await expect(store().edit("TR-042", { status: "Done" })).rejects.toThrow("Ticket TR-042 does not exist.");
      await expect(store().appendNote("TR-042", "x")).rejects.toBeInstanceOf(TicketNotFound);
      await expect(store().view("TR-042")).rejects.toThrow("TR-042");
    });

    it("refuses an id that could leave the tickets folder", async () => {
      await expect(store().view("../tracker")).rejects.toThrow(/not a ticket id/);
    });

    it("refuses a note or FINAL stamped later than the clock and writes nothing (TR-086)", async () => {
      await writeTicketFile({ id: "TR-001", notes: "earlier" });
      const before = await readFile(ticketPath("TR-001"), "utf8");
      await expect(store().appendNote("TR-001", "REVIEW 2026-10-14T17:40Z — done")).rejects.toThrow(
        "REVIEW 2026-10-14T17:40Z is later than the host clock (now 2026-10-14T16:20Z)",
      );
      await expect(store().edit("TR-001", { finalSummary: "FINAL 2026-10-14T17:40Z — x", status: "Awaiting acceptance" })).rejects.toThrow(
        /later than the host clock/,
      );
      expect(await readFile(ticketPath("TR-001"), "utf8")).toBe(before);
      await store().appendNote("TR-001", "MILESTONE 2026-10-14T16:20Z — on time");
      expect((await store().view("TR-001")).ticket.notes).toBe("earlier\n\nMILESTONE 2026-10-14T16:20Z — on time");
    });

    it("editIf applies its changes only when the ticket under the lock passes, and writes nothing otherwise (TR-130)", async () => {
      await writeTicketFile({ id: "TR-001", status: "Awaiting acceptance", notes: "earlier" });
      const before = await readFile(ticketPath("TR-001"), "utf8");
      const seen: string[] = [];
      expect(
        await store().editIf("TR-001", (ticket) => {
          seen.push(ticket.status);
          return ticket.status === "Done";
        }, { status: "In Progress", appendNotes: ["record"] }),
      ).toBeNull();
      expect(seen).toEqual(["Awaiting acceptance"]);
      expect(await readFile(ticketPath("TR-001"), "utf8")).toBe(before);

      const edited = await store().editIf("TR-001", (ticket) => ticket.status === "Awaiting acceptance", { status: "In Progress", appendNotes: ["record"] });
      expect(edited).toMatchObject({ status: "In Progress", notes: "earlier\n\nrecord" });
      expect((await store().view("TR-001")).ticket).toEqual(edited);
      await expect(store().editIf("TR-042", () => true, { status: "Done" })).rejects.toBeInstanceOf(TicketNotFound);
    });

    it("a record ending in many newlines is stored without them", async () => {
      await writeTicketFile({ id: "TR-001", notes: "earlier" });
      await store().appendNote("TR-001", "record\n\n\n\n\n\n");
      const { ticket } = await store().view("TR-001");
      expect(ticket.notes).toBe("earlier\n\nrecord");
      expect(await readFile(ticketPath("TR-001"), "utf8")).toContain("earlier\n\nrecord\n<!-- /taro:notes -->");
    });
  });

  describe("revision", () => {
    it("a stale revision throws RevisionConflict and leaves the file unchanged", async () => {
      const tickets = store();
      await tickets.create({ title: "One" });
      const { revision: stale } = await tickets.view("TR-001");
      await tickets.edit("TR-001", { status: "Ready" });
      const before = await readFile(ticketPath("TR-001"), "utf8");
      const error = await tickets.edit("TR-001", { title: "Clobber" }, { revision: stale }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RevisionConflict);
      expect((error as RevisionConflict).current).toBe((await tickets.view("TR-001")).revision);
      expect((error as Error).message).toContain((error as RevisionConflict).current);
      expect(await readFile(ticketPath("TR-001"), "utf8")).toBe(before);
    });

    it("the current revision succeeds", async () => {
      const tickets = store();
      await tickets.create({ title: "One" });
      const { revision } = await tickets.view("TR-001");
      const edited = await tickets.edit("TR-001", { title: "Two" }, { revision });
      expect(edited.title).toBe("Two");
      expect((await tickets.view("TR-001")).revision).not.toBe(revision);
    });

    it("appends need none, even after other writes", async () => {
      const tickets = store();
      await tickets.create({ title: "One" });
      await tickets.edit("TR-001", { status: "Ready" });
      await tickets.appendNote("TR-001", "note");
      expect((await tickets.view("TR-001")).ticket.notes).toBe("note");
    });
  });

  describe("ids", () => {
    it("are never reused after the highest ticket file is deleted (tracker.json lastId)", async () => {
      const tickets = store();
      await tickets.create({ title: "One" });
      await tickets.create({ title: "Two" });
      await unlink(ticketPath("TR-002"));
      expect((await tickets.create({ title: "Three" })).id).toBe("TR-003");
      expect(JSON.parse(await readFile(join(tracker, "tracker.json"), "utf8"))).toMatchObject({ lastId: 3, prefix: "TR", padding: 3 });
    });

    it("children get .01, .02… and never reuse either", async () => {
      const tickets = store();
      await tickets.create({ title: "Parent" });
      expect((await tickets.create({ title: "A", parent: "TR-001" })).id).toBe("TR-001.01");
      expect((await tickets.create({ title: "B", parent: "TR-001" })).id).toBe("TR-001.02");
      await unlink(ticketPath("TR-001.02"));
      expect((await tickets.create({ title: "C", parent: "TR-001" })).id).toBe("TR-001.03");
      expect((await tickets.create({ title: "Next" })).id).toBe("TR-002");
      expect(JSON.parse(await readFile(join(tracker, "tracker.json"), "utf8")).lastChild).toEqual({ "TR-001": 3 });
      const { subtasks } = await tickets.view("TR-001");
      expect(subtasks.map((summary) => summary.id)).toEqual(["TR-001.01", "TR-001.03"]);
    });

    it("tracker.json missing: create makes it, inferring prefix, padding and lastId from the files", async () => {
      await writeTicketFile({ id: "AB-0007" });
      await writeTicketFile({ id: "AB-0012" });
      await writeTicketFile({ id: "AB-0012.04", parent: "AB-0012" });
      const tickets = store();
      expect((await tickets.create({ title: "Next" })).id).toBe("AB-0013");
      expect((await tickets.create({ title: "Child", parent: "AB-0012" })).id).toBe("AB-0012.05");
      expect(JSON.parse(await readFile(join(tracker, "tracker.json"), "utf8"))).toEqual({
        schema: 1,
        prefix: "AB",
        padding: 4,
        lastId: 13,
        lastChild: { "AB-0012": 5 },
      });
    });

    it("files beyond tracker.json's lastId win", async () => {
      await writeFile(join(tracker, "tracker.json"), JSON.stringify({ schema: 1, prefix: "TR", padding: 3, lastId: 2, lastChild: {} }));
      await writeTicketFile({ id: "TR-010" });
      expect((await store().create({ title: "Next" })).id).toBe("TR-011");
    });
  });

  describe("concurrency across processes", () => {
    it("20 concurrent appendNote calls land all 20 records exactly once", async () => {
      await store().create({ title: "Shared" });
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          inNode(`await createTicketStore(process.env.TRACKER).appendNote("TR-001", "record ${index} $& 🚀");`),
        ),
      );
      const parsed = parseTicket(await readFile(ticketPath("TR-001"), "utf8"), "TR-001.md");
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const records = parsed.ticket.notes.split("\n\n");
      expect(records).toHaveLength(20);
      expect(records.slice().sort()).toEqual(Array.from({ length: 20 }, (_, index) => `record ${index} $& 🚀`).sort());
      expect(await readdir(join(tracker, ".taro"))).toEqual([]);
    }, 60_000);

    it("20 concurrent creates give 20 distinct consecutive ids", async () => {
      const outputs = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          inNode(`console.log((await createTicketStore(process.env.TRACKER).create({ title: "Ticket ${index}" })).id);`),
        ),
      );
      const ids = outputs.map((output) => output.stdout.trim()).sort();
      expect(ids).toEqual(Array.from({ length: 20 }, (_, index) => `TR-${String(index + 1).padStart(3, "0")}`));
      const { tickets, problems } = await store().list();
      expect(problems).toEqual([]);
      expect(tickets).toHaveLength(20);
      expect(JSON.parse(await readFile(join(tracker, "tracker.json"), "utf8")).lastId).toBe(20);
    }, 60_000);

    it("concurrent writes within one process all land", async () => {
      const tickets = store();
      await tickets.create({ title: "Shared" });
      await Promise.all(Array.from({ length: 10 }, (_, index) => tickets.appendNote("TR-001", `r${index}`)));
      expect((await tickets.view("TR-001")).ticket.notes.split("\n\n")).toHaveLength(10);
    });
  });

  describe("lock", () => {
    const lockDirectory = (): string => join(tracker, ".taro", "lock");
    async function holdLock(owner: object | null, ageMs = 0): Promise<void> {
      await mkdir(lockDirectory(), { recursive: true });
      if (owner !== null) await writeFile(join(lockDirectory(), "owner.json"), JSON.stringify(owner));
      if (ageMs > 0) {
        const then = new Date(Date.now() - ageMs);
        await utimes(lockDirectory(), then, then);
      }
    }

    it("a lock held by a dead pid on this host is broken at once", async () => {
      await store().create({ title: "One" });
      await holdLock({ pid: deadPid(), host: hostname(), at: "2026-10-14T16:00:00Z", token: "dead" });
      const started = Date.now();
      await store({ lockTimeoutMs: 5_000 }).appendNote("TR-001", "after a crash");
      expect(Date.now() - started).toBeLessThan(1_000);
      expect((await store().view("TR-001")).ticket.notes).toBe("after a crash");
      expect(await readdir(join(tracker, ".taro"))).toEqual([]);
    });

    it("a lock held by a live pid is waited on and never broken; the write fails after the timeout naming the pid", async () => {
      await store().create({ title: "One" });
      const before = await readFile(ticketPath("TR-001"), "utf8");
      await holdLock({ pid: process.pid, host: hostname(), at: "2026-01-01T00:00:00Z", token: "live" }, 60 * 60_000);
      const started = Date.now();
      await expect(store({ lockTimeoutMs: 400 }).appendNote("TR-001", "blocked")).rejects.toThrow(`pid ${process.pid}`);
      expect(Date.now() - started).toBeGreaterThanOrEqual(400);
      expect(JSON.parse(await readFile(join(lockDirectory(), "owner.json"), "utf8")).token).toBe("live");
      expect(await readFile(ticketPath("TR-001"), "utf8")).toBe(before);
    });

    it("a write waits for a live holder and proceeds once it releases", async () => {
      await store().create({ title: "One" });
      await holdLock({ pid: process.pid, host: hostname(), at: "2026-10-14T16:00:00Z", token: "live" });
      setTimeout(() => rmSync(lockDirectory(), { recursive: true, force: true }), 300);
      await store({ lockTimeoutMs: 5_000 }).appendNote("TR-001", "waited");
      expect((await store().view("TR-001")).ticket.notes).toBe("waited");
    });

    it("a lock held by a pid on another host is not broken", async () => {
      await store().create({ title: "One" });
      await holdLock({ pid: deadPid(), host: `${hostname()}-elsewhere`, at: "2026-10-14T16:00:00Z", token: "remote" });
      await expect(store({ lockTimeoutMs: 200 }).appendNote("TR-001", "x")).rejects.toThrow(/locked by pid/);
    });

    it("a lock dir without owner.json older than 10 s is broken", async () => {
      await store().create({ title: "One" });
      await holdLock(null, 11_000);
      await store({ lockTimeoutMs: 5_000 }).appendNote("TR-001", "after stale");
      expect((await store().view("TR-001")).ticket.notes).toBe("after stale");
    });

    // Regression (TR-081.01 review): two waiters breaking one dead lock used to move a live lock aside, letting two writers in.
    it("processes contending for a dead holder's lock land every record once and leave no lock behind", async () => {
      await store().create({ title: "Shared" });
      const rounds = 15;
      const writers = 12;
      for (let round = 0; round < rounds; round++) {
        await holdLock({ pid: deadPid(), host: hostname(), at: "2026-10-14T16:00:00Z", token: `dead-${round}` });
        await Promise.all(
          Array.from({ length: writers }, (_, index) =>
            inNode(`await createTicketStore(process.env.TRACKER).appendNote("TR-001", "round ${round} writer ${index}");`),
          ),
        );
      }
      const parsed = parseTicket(await readFile(ticketPath("TR-001"), "utf8"), "TR-001.md");
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const expected = Array.from({ length: rounds * writers }, (_, index) => `round ${Math.floor(index / writers)} writer ${index % writers}`);
      expect(parsed.ticket.notes.split("\n\n").sort()).toEqual(expected.sort());
      expect(await readdir(join(tracker, ".taro"))).toEqual([]);
    }, 180_000);

    it("a fresh lock dir without owner.json is waited on", async () => {
      await store().create({ title: "One" });
      await holdLock(null);
      await expect(store({ lockTimeoutMs: 200 }).appendNote("TR-001", "x")).rejects.toThrow(/unknown process/);
    });
  });

  describe("cached reads", () => {
    function countingStore() {
      const reads: string[] = [];
      const tickets = store({
        readFile: async (path) => {
          reads.push(path.slice(path.lastIndexOf("/") + 1));
          return readFile(path, "utf8");
        },
      });
      return { tickets, reads };
    }

    it("list() re-reads only changed files", async () => {
      for (const id of ["TR-001", "TR-002", "TR-003"]) await writeTicketFile({ id });
      const { tickets, reads } = countingStore();
      expect((await tickets.list()).tickets.map((summary) => summary.id)).toEqual(["TR-001", "TR-002", "TR-003"]);
      expect(reads.sort()).toEqual(["TR-001.md", "TR-002.md", "TR-003.md"]);
      reads.length = 0;
      await tickets.list();
      expect(reads).toEqual([]);
      await writeTicketFile({ id: "TR-002", title: "Changed title" });
      const later = new Date(Date.now() + 5_000);
      await utimes(ticketPath("TR-002"), later, later);
      const { tickets: listed } = await tickets.list();
      expect(reads).toEqual(["TR-002.md"]);
      expect(listed.find((summary) => summary.id === "TR-002")?.title).toBe("Changed title");
    });

    it("forget() invalidates one entry or all", async () => {
      for (const id of ["TR-001", "TR-002"]) await writeTicketFile({ id });
      const { tickets, reads } = countingStore();
      await tickets.list();
      reads.length = 0;
      tickets.forget("tickets/TR-001.md");
      await tickets.list();
      expect(reads).toEqual(["TR-001.md"]);
      reads.length = 0;
      tickets.forget();
      await tickets.list();
      expect(reads.sort()).toEqual(["TR-001.md", "TR-002.md"]);
    });

    it("list() drops deleted files", async () => {
      for (const id of ["TR-001", "TR-002"]) await writeTicketFile({ id });
      const { tickets } = countingStore();
      await tickets.list();
      await unlink(ticketPath("TR-001"));
      expect((await tickets.list()).tickets.map((summary) => summary.id)).toEqual(["TR-002"]);
      expect([...tickets.cacheEntries().keys()]).toEqual(["TR-002.md"]);
    });

    it("keeps no body text in the cache: entries hold summary fields only", async () => {
      await writeTicketFile({ id: "TR-001", description: "BODY-DESCRIPTION", plan: "BODY-PLAN", notes: "BODY-NOTES", finalSummary: "BODY-FINAL" });
      const { tickets } = countingStore();
      await tickets.list();
      const entry = tickets.cacheEntries().get("TR-001.md");
      expect(Object.keys(entry ?? {}).sort()).toEqual(["mtimeMs", "problems", "size", "summary"]);
      expect(Object.keys(entry?.summary ?? {}).sort()).toEqual(
        ["created", "criteriaChecked", "criteriaCount", "dependsOn", "file", "id", "labels", "parent", "priority", "revision", "status", "title", "updated"].sort(),
      );
      expect(JSON.stringify([...tickets.cacheEntries().values()])).not.toMatch(/BODY-/);
    });

    it("one malformed file yields one problem while the others list", async () => {
      await writeTicketFile({ id: "TR-001" });
      await writeTicketFile({ id: "TR-003" });
      await writeFile(ticketPath("TR-002"), "---\nschema: 1\nid: \"TR-002\"\ntitle: broken\n");
      const { tickets, problems } = await store().list();
      expect(tickets.map((summary) => summary.id)).toEqual(["TR-001", "TR-003"]);
      expect(problems).toEqual([{ file: "tickets/TR-002.md", line: 1, message: expect.stringContaining("unclosed frontmatter") }]);
    });

    it("search() matches id, title and bodies case-insensitively", async () => {
      await writeTicketFile({ id: "TR-001", title: "Alpha" });
      await writeTicketFile({ id: "TR-002", notes: "the Needle is here" });
      await writeTicketFile({ id: "TR-003", finalSummary: "NEEDLE" });
      await writeTicketFile({ id: "TR-004", plan: "nothing" });
      const tickets = store();
      expect((await tickets.search("needle")).map((summary) => summary.id)).toEqual(["TR-002", "TR-003"]);
      expect((await tickets.search("tr-004")).map((summary) => summary.id)).toEqual(["TR-004"]);
      expect((await tickets.search("ALPHA")).map((summary) => summary.id)).toEqual(["TR-001"]);
      expect(tickets.cacheEntries().size).toBe(0);
    });
  });

  describe("temp files", () => {
    it("a stray temp file older than a minute is removed on the next write; a young one stays", async () => {
      const tickets = store();
      await tickets.create({ title: "One" });
      const old = join(tracker, "tickets", ".TR-001.123.abc.tmp");
      const young = join(tracker, "tickets", ".TR-001.124.def.tmp");
      await writeFile(old, "partial");
      await writeFile(young, "partial");
      const then = new Date(Date.now() - 2 * 60_000);
      await utimes(old, then, then);
      await tickets.appendNote("TR-001", "x");
      await expect(stat(old)).rejects.toThrow();
      expect((await stat(young)).isFile()).toBe(true);
    });

    it("list() ignores .tmp files and .taro/", async () => {
      await writeTicketFile({ id: "TR-001" });
      await writeFile(join(tracker, "tickets", ".TR-002.1.abc.tmp"), "partial");
      await mkdir(join(tracker, ".taro"), { recursive: true });
      await writeFile(join(tracker, ".taro", "TR-003.md"), "not a ticket");
      const { tickets, problems } = await store().list();
      expect(tickets.map((summary) => summary.id)).toEqual(["TR-001"]);
      expect(problems).toEqual([]);
    });

    it("a write leaves no temp file behind", async () => {
      const tickets = store();
      await tickets.create({ title: "One" });
      await tickets.appendNote("TR-001", "x");
      expect(await readdir(join(tracker, "tickets"))).toEqual(["TR-001.md"]);
    });
  });
});
