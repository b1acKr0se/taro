/**
 * One throwaway Paseo daemon for one benchmark run: its own home and port, the plugin installed from a
 * detached copy of a checkout, a scratch repository, and the cleanup of all of it. Runs under Node
 * type stripping: erasable syntax, `.ts` import extensions, no packages.
 */
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, cpSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { alive, killGroup, run, startDetached, startedPids } from "./process.ts";
import { PORT_RANGE, SCRATCH_PREFIX, assertSafeHome, assertSafePort } from "./safety.ts";

/** The checkout this benchmark runs from: its tools and `bin/taro` are used, not the plugin copy's. */
export const BENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Throwaway {
  home: string;
  port: number;
  /** A detached copy of the plugin checkout, without its `bench/` folder. */
  pluginCopy: string;
  pluginSource: string;
  repository: string;
  deciderDirectory: string;
  daemonPid: number | null;
  /** Folders to remove at cleanup, each made by `scratchDirectory`. */
  folders: string[];
}

export function makeThrowaway(pluginSource: string): Throwaway {
  return { home: "", port: 0, pluginCopy: "", pluginSource, repository: "", deciderDirectory: "", daemonPid: null, folders: [] };
}

/** A fresh `mktemp -d` folder of the benchmark's, remembered for cleanup. */
export function scratchDirectory(throwaway: Throwaway, kind: string): string {
  const path = mkdtempSync(join(tmpdir(), `${SCRATCH_PREFIX}${kind}.`));
  assertSafeHome(path);
  throwaway.folders.push(path);
  return path;
}

/** Waits while the host's thread use is above 85% of its limit (every agent costs about 65 threads). */
export async function waitForThreads(log: (line: string) => void): Promise<void> {
  const read = (name: string): string | null => {
    try {
      return readFileSync(`/sys/fs/cgroup/${name}`, "utf8").trim();
    } catch {
      return null;
    }
  };
  for (;;) {
    const current = Number(read("pids.current"));
    const max = Number(read("pids.max"));
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0 || current / max <= 0.85) return;
    log(`threads ${current} of ${max}: waiting`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 30_000));
  }
}

function freePort(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(true)));
  });
}

/** A random free port in 6810-6899. */
export async function pickPort(): Promise<number> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const port = PORT_RANGE.first + Math.floor(Math.random() * (PORT_RANGE.last - PORT_RANGE.first + 1));
    assertSafePort(port);
    if (await freePort(port)) return port;
  }
  throw new Error("no free port in 6810-6899");
}

/** `git worktree add --detach` of the checkout at `sha`, with `bench/` removed so the owner cannot read hidden tests. */
export async function makePluginCopy(throwaway: Throwaway, sha: string): Promise<void> {
  const copy = scratchDirectory(throwaway, "plugin");
  const added = await run("git", ["-C", throwaway.pluginSource, "worktree", "add", "--detach", copy, sha]);
  if (added.code !== 0) throw new Error(`git worktree add failed: ${added.stderr}`);
  throwaway.pluginCopy = copy;
  rmSync(join(copy, "bench"), { recursive: true, force: true });
  // The plugin's compile resolves zod and the host's types from node_modules; the copy shares the checkout's.
  const modules = join(throwaway.pluginSource, "node_modules");
  if (existsSync(modules)) symlinkSync(modules, join(copy, "node_modules"));
}

/** Writes the daemon's config, starts it, and waits until it answers. */
export async function startDaemon(throwaway: Throwaway): Promise<void> {
  assertSafeHome(throwaway.home);
  assertSafePort(throwaway.port);
  writeFileSync(
    join(throwaway.home, "config.json"),
    JSON.stringify({ version: 1, daemon: { listen: `127.0.0.1:${throwaway.port}` }, pluginsEnabled: true, features: { webUi: { enabled: true } } }),
  );
  const logFd = openSync(join(throwaway.home, "run.log"), "a");
  const child = startDetached("paseo", ["daemon", "run", "--home", throwaway.home], { logFd });
  closeSync(logFd);
  throwaway.daemonPid = child.pid ?? null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`the daemon exited with ${child.exitCode}; see ${join(throwaway.home, "run.log")}`);
    const answered = await fetch(`http://127.0.0.1:${throwaway.port}/`).then(() => true, () => false);
    if (answered) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error("the daemon did not answer within a minute");
}

export function paseoArgs(throwaway: Throwaway): string[] {
  return ["--home", throwaway.home];
}

/** A Taro plugin RPC on the throwaway daemon (tools/rpc.mjs). */
export async function rpc(throwaway: Throwaway, method: string, input: unknown): Promise<unknown> {
  const result = await run("node", [join(BENCH_ROOT, "tools", "rpc.mjs"), method, JSON.stringify(input)], {
    env: { TARO_DAEMON_URL: `ws://127.0.0.1:${throwaway.port}/ws` },
    timeoutMs: 60_000,
  });
  if (result.code !== 0) throw new Error(`rpc ${method} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return JSON.parse(result.stdout);
}

export async function installPlugin(throwaway: Throwaway): Promise<void> {
  const installed = await run("paseo", ["plugin", "install", throwaway.pluginCopy, ...paseoArgs(throwaway)], { timeoutMs: 180_000 });
  if (installed.code !== 0) throw new Error(`paseo plugin install failed: ${installed.stderr || installed.stdout}`);
  // The plugin starts with the daemon's plugin host: ask it something until it answers.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const answered = await rpc(throwaway, "taro.projects.list", {}).then(() => true, () => false);
    if (answered) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error("the plugin did not answer after install");
}

/** A scratch git repository with the task's files in one commit on main. */
export async function seedRepository(throwaway: Throwaway, taskRepository: string): Promise<void> {
  const repository = scratchDirectory(throwaway, "repo");
  cpSync(taskRepository, repository, { recursive: true });
  const git = (...args: string[]) => run("git", ["-C", repository, "-c", "user.name=Taro bench", "-c", "user.email=bench@example.invalid", ...args]);
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "Seed"]]) {
    const done = await git(...args);
    if (done.code !== 0) throw new Error(`git ${args[0]} failed: ${done.stderr}`);
  }
  throwaway.repository = repository;
}

/** Processes that still run from this benchmark's folders or home, by `ps` (pid, command). */
export async function leftovers(throwaway: Throwaway): Promise<string[]> {
  const listing = await run("ps", ["-eo", "pid,ppid,etime,args"]);
  const marks = [...throwaway.folders, throwaway.home].filter((mark) => mark !== "");
  return listing.stdout
    .split("\n")
    .filter((line) => marks.some((mark) => line.includes(mark)) && !line.includes(" ps -eo"))
    .map((line) => line.trim());
}

/**
 * Stops the daemon, kills what is left by pid, and removes the worktree copy, the home and the scratch
 * folders by their literal paths. Safe to call twice. Returns what it found left over.
 */
export async function cleanup(throwaway: Throwaway): Promise<{ leftoverProcesses: string[]; removed: string[] }> {
  if (throwaway.home !== "" && existsSync(throwaway.home)) await run("paseo", ["daemon", "stop", "--home", throwaway.home], { timeoutMs: 30_000 });
  if (throwaway.daemonPid !== null && alive(throwaway.daemonPid)) killGroup(throwaway.daemonPid);
  await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
  // Agents and the plugin host the daemon started are in its group or its home: find them by what they were started from.
  const found = await leftovers(throwaway);
  for (const line of found) {
    const pid = Number(line.split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid !== process.pid && pid > 1) killGroup(pid, "SIGKILL");
  }
  startedPids().forEach(([pid]) => killGroup(pid, "SIGKILL"));
  if (throwaway.daemonPid !== null && alive(throwaway.daemonPid)) killGroup(throwaway.daemonPid, "SIGKILL");
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const leftoverProcesses = await leftovers(throwaway);
  const removed: string[] = [];
  if (throwaway.pluginCopy !== "") {
    try {
      unlinkSync(join(throwaway.pluginCopy, "node_modules"));
    } catch {
      // no link made
    }
    await run("git", ["-C", throwaway.pluginSource, "worktree", "remove", "--force", throwaway.pluginCopy]);
    await run("git", ["-C", throwaway.pluginSource, "worktree", "prune"]);
  }
  // The scratch repository has worktrees of its own (the owner's): removed with it, and its home too.
  [...throwaway.folders, ...(throwaway.home === "" ? [] : [throwaway.home])].forEach((path) => {
    assertSafeHome(path);
    rmSync(path, { recursive: true, force: true });
    removed.push(path);
  });
  // The owner's worktree lives under the daemon home (`<home>/worktrees`), removed with it.
  throwaway.folders = [];
  return { leftoverProcesses, removed };
}

export function listFolder(path: string): string[] {
  return existsSync(path) ? readdirSync(path) : [];
}

export function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}
