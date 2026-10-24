// TR-232: the lists behind the composer's `/`, `@` and `#` pickers.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serializeTicket, type Ticket } from "../shared/ticket-format";
import { agentCommands, fileIndexOf, forgetFileIndexes, projectFiles, recentCommands, rememberRecentCommand, ticketsForPicks, type CommandRunner } from "./composer-picks";
import type { PaseoApi } from "./host-types";
import { runChecked, runCommand } from "./process";
import { writeProjectConfig } from "./projects";

let home = "";
vi.mock("./config", () => ({ readGlobalConfig: async () => ({}), resolveTaroHome: () => home }));

const scratch: string[] = [];

const byPath = (left: { path: string }, right: { path: string }): number => (left.path < right.path ? -1 : 1);

async function scratchDirectory(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `taro-picks-${name}-`));
  scratch.push(directory);
  return directory;
}

async function git(repository: string, ...args: string[]): Promise<string> {
  return runChecked("git", ["-c", "user.email=taro@example.com", "-c", "user.name=Taro", "-c", "commit.gpgsign=false", ...args], { cwd: repository });
}

async function put(repository: string, path: string, text: string): Promise<void> {
  await mkdir(join(repository, path, ".."), { recursive: true });
  await writeFile(join(repository, path), text);
}

/** A repository on `main` with a tracked file in a sub-folder, an ignored file and an untracked one. */
async function repository(): Promise<string> {
  const directory = await scratchDirectory("repo");
  await git(directory, "init", "-q", "-b", "main");
  await put(directory, ".gitignore", "*.log\n");
  await put(directory, "README.md", "hello\n");
  await put(directory, "src/app.ts", "export {};\n");
  await put(directory, "src/old.ts", "old\n");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-qm", "first");
  await put(directory, "debug.log", "noise\n");
  await put(directory, "notes.txt", "untracked\n");
  return directory;
}

function stubPaseo(agents: Record<string, { cwd: string; archivedAt?: string | null }>, commands?: () => Promise<unknown>): PaseoApi {
  return {
    agents: {
      ref: (agentId: string) => ({
        refresh: async () => (agents[agentId] === undefined ? null : { agent: { id: agentId, archivedAt: null, ...agents[agentId] } }),
        commands: commands ?? (async () => ({ commands: [], error: null })),
      }),
    },
  } as unknown as PaseoApi;
}

async function project(name = "notes"): Promise<void> {
  await writeProjectConfig({
    schemaVersion: 1,
    project: name,
    paseoProjectId: "prj_1",
    repoPath: "/repo",
    baseBranch: "main",
    ticketPrefix: "NA",
    manager: { model: "claude/opus", thinking: "" },
    owner: { model: "claude/opus", thinking: "" },
  } as Parameters<typeof writeProjectConfig>[0]);
}

beforeEach(async () => {
  home = await scratchDirectory("home");
  forgetFileIndexes();
});

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("the agent's commands", () => {
  it("passes the provider's commands through, each name once, with its error", async () => {
    const paseo = stubPaseo({}, async () => ({
      agentId: "a",
      requestId: "r",
      error: null,
      commands: [
        { name: "compact", description: "Compact", argumentHint: "" },
        { name: "review", description: "Review", argumentHint: "<pr>", kind: "skill" },
        { name: "compact", description: "Again", argumentHint: "" },
      ],
    }));
    expect(await agentCommands(paseo, "a")).toEqual({
      commands: [
        { name: "compact", description: "Compact", argumentHint: "" },
        { name: "review", description: "Review", argumentHint: "<pr>", kind: "skill" },
      ],
      error: null,
    });
  });

  it("leaves out the commands that would wipe or close a Taro agent", async () => {
    const paseo = stubPaseo({}, async () => ({
      agentId: "a",
      requestId: "r",
      error: null,
      commands: ["clear", "reset", "new", "exit", "compact", "clearly"].map((name) => ({ name, description: name, argumentHint: "" })),
    }));
    expect((await agentCommands(paseo, "a")).commands.map((command) => command.name)).toEqual(["compact", "clearly"]);
  });

  it("keeps the error a provider reports", async () => {
    const paseo = stubPaseo({}, async () => ({ agentId: "a", requestId: "r", commands: [], error: "Codex cannot list commands" }));
    expect(await agentCommands(paseo, "a")).toEqual({ commands: [], error: "Codex cannot list commands" });
  });

  it("turns a rejection into an empty list with its message", async () => {
    const paseo = stubPaseo({}, async () => Promise.reject(new Error("Agent not found")));
    expect(await agentCommands(paseo, "a")).toEqual({ commands: [], error: "Agent not found" });
  });
});

describe("the project's files", () => {
  it("lists tracked and untracked files from the agent's folder, leaving ignored ones out", async () => {
    await project();
    const directory = await repository();
    const index = await projectFiles(stubPaseo({ agent: { cwd: directory } }), "notes", "agent");
    expect([...index.files].sort()).toEqual([".gitignore", "README.md", "notes.txt", "src/app.ts", "src/old.ts"]);
    expect(index.truncated).toBe(false);
  });

  it("marks what the branch and the working tree changed since the base branch, leaving deleted files out", async () => {
    const directory = await repository();
    await git(directory, "checkout", "-q", "-b", "feature");
    await put(directory, "src/added.ts", "new\n");
    await put(directory, "README.md", "hello again\n");
    await git(directory, "rm", "-q", "src/old.ts");
    await git(directory, "add", "src/added.ts", "README.md");
    await git(directory, "commit", "-qm", "branch work");
    await put(directory, "src/app.ts", "export const edited = true;\n");
    await put(directory, "src/draft.ts", "draft\n");
    const index = await fileIndexOf(directory, "main");
    const changed = [...index.changed].sort(byPath);
    expect(changed).toEqual([
      { path: "README.md", status: "changed" },
      { path: "notes.txt", status: "new" },
      { path: "src/added.ts", status: "new" },
      { path: "src/app.ts", status: "changed" },
      { path: "src/draft.ts", status: "new" },
    ]);
  });

  it("lists only uncommitted changes when the base branch is missing", async () => {
    const directory = await repository();
    await put(directory, "src/app.ts", "edited\n");
    const index = await fileIndexOf(directory, "no-such-branch");
    expect([...index.changed].sort(byPath)).toEqual([
      { path: "notes.txt", status: "new" },
      { path: "src/app.ts", status: "changed" },
    ]);
  });

  it("lists files of recent commits newest first, once each, only those that still exist", async () => {
    const directory = await repository();
    await put(directory, "src/second.ts", "2\n");
    await git(directory, "add", "src/second.ts");
    await git(directory, "commit", "-qm", "second");
    await git(directory, "rm", "-q", "src/old.ts");
    await put(directory, "src/app.ts", "edited\n");
    await git(directory, "commit", "-qam", "third");
    const index = await fileIndexOf(directory, "main");
    expect(index.recent).toEqual(["src/app.ts", "src/second.ts", ".gitignore", "README.md"]);
  });

  it("walks a folder without git, skipping dot-folders and node_modules", async () => {
    const directory = await scratchDirectory("plain");
    await put(directory, "a.txt", "a");
    await put(directory, ".env", "dot file");
    await put(directory, "docs/guide/intro.md", "intro");
    await put(directory, ".cache/x", "skipped");
    await put(directory, "node_modules/lib/index.js", "skipped");
    const index = await fileIndexOf(directory, "main");
    expect(index).toEqual({ files: [".env", "a.txt", "docs/guide/intro.md"], changed: [], recent: [], truncated: false });
  });

  it("falls back to the walk when git fails", async () => {
    const directory = await scratchDirectory("broken");
    await put(directory, "a.txt", "a");
    const failing: CommandRunner = async () => Promise.reject(new Error("spawn git ENOENT"));
    expect((await fileIndexOf(directory, "main", failing)).files).toEqual(["a.txt"]);
  });

  it("answers a second call for the same folder from the cache", async () => {
    const directory = await repository();
    let listings = 0;
    const counting: CommandRunner = (command, args, options) => {
      if (args.includes("ls-files")) listings += 1;
      return runCommand(command, args, options);
    };
    const first = await fileIndexOf(directory, "main", counting);
    const second = await fileIndexOf(directory, "main", counting);
    expect(second).toBe(first);
    expect(listings).toBe(1);
  });

  it("rejects plainly for an unknown or archived agent, a missing folder or an unknown project", async () => {
    await project();
    const directory = await repository();
    const paseo = stubPaseo({ archived: { cwd: directory, archivedAt: "2026-10-24T10:00:00Z" }, moved: { cwd: join(directory, "gone") } });
    await expect(projectFiles(paseo, "notes", "unknown")).rejects.toThrow("This agent is gone.");
    await expect(projectFiles(paseo, "notes", "archived")).rejects.toThrow("This agent is gone.");
    await expect(projectFiles(paseo, "notes", "moved")).rejects.toThrow("no longer exists");
    await expect(projectFiles(paseo, "elsewhere", "archived")).rejects.toThrow("Taro has no project named elsewhere.");
  });

  it("answers within 1.5 seconds on this repository", async () => {
    await project();
    const worktree = join(dirname(fileURLToPath(import.meta.url)), "..");
    const started = performance.now();
    const index = await projectFiles(stubPaseo({ agent: { cwd: worktree } }), "notes", "agent");
    const elapsed = performance.now() - started;
    console.log(`[composer-picks] ${index.files.length} files, ${index.changed.length} changed, ${index.recent.length} recent in ${elapsed.toFixed(0)} ms`);
    expect(index.files).toContain("server/composer-picks.ts");
    expect(elapsed).toBeLessThan(1500);
  });
});

describe("the project's tickets", () => {
  it("lists every ticket's id, title and status", async () => {
    await project();
    const tracker = join(home, "projects", "notes", "tracker");
    await mkdir(join(tracker, "tickets"), { recursive: true });
    await writeFile(join(tracker, "tracker.json"), '{"schema":1,"prefix":"NA","padding":3,"lastId":2,"lastChild":{}}\n');
    const ticket = (id: string, title: string, status: Ticket["status"]): Ticket => ({
      id,
      title,
      status,
      priority: null,
      labels: [],
      parent: null,
      dependsOn: [],
      created: "2026-10-14T15:46:00Z",
      updated: "2026-10-14T16:20:31Z",
      description: "",
      plan: "",
      criteria: [],
      notes: "",
      finalSummary: "",
      extra: {},
    });
    await writeFile(join(tracker, "tickets", "NA-001.md"), serializeTicket(ticket("NA-001", "Export notes", "Done")));
    await writeFile(join(tracker, "tickets", "NA-002.md"), serializeTicket(ticket("NA-002", "Share a note", "In Progress")));
    const tickets = await ticketsForPicks("notes");
    expect([...tickets].sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      { id: "NA-001", title: "Export notes", status: "Done" },
      { id: "NA-002", title: "Share a note", status: "In Progress" },
    ]);
  });
});

describe("recent commands", () => {
  it("puts the latest first, keeps eight, and reads them back from the project's file", async () => {
    await project();
    expect(await recentCommands("notes")).toEqual([]);
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) await rememberRecentCommand("notes", name);
    expect(await rememberRecentCommand("notes", "c")).toEqual(["c", "i", "h", "g", "f", "e", "d", "b"]);
    expect(await recentCommands("notes")).toEqual(["c", "i", "h", "g", "f", "e", "d", "b"]);
    expect(JSON.parse(await readFile(join(home, "projects", "notes", "recent-commands.json"), "utf8"))).toEqual(["c", "i", "h", "g", "f", "e", "d", "b"]);
  });

  it("rejects an unknown project", async () => {
    await expect(recentCommands("elsewhere")).rejects.toThrow("Taro has no project named elsewhere.");
    await expect(rememberRecentCommand("elsewhere", "compact")).rejects.toThrow("Taro has no project named elsewhere.");
  });
});
