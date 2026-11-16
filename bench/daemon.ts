/**
 * One throwaway Paseo daemon for one benchmark run: its own home and port, the plugin installed from a
 * `git archive` copy of a checkout, a scratch repository, and the cleanup of all of it. Runs under Node
 * type stripping: erasable syntax, `.ts` import extensions, no packages.
 */
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, cpSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { alive, killGroup, run, startDetached, startedPids } from "./process.ts";
import type { RunResult } from "./process.ts";
import { PORT_RANGE, SCRATCH_PREFIX, assertSafeHome, assertSafePort } from "./safety.ts";

/** The checkout this benchmark runs from: its tools and `bin/taro` are used, not the plugin copy's. */
export const BENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Throwaway {
  home: string;
  port: number;
  /** A `git archive` copy of the plugin checkout, without its `bench/` folder or `.git`. */
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
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const port = PORT_RANGE.first + Math.floor(Math.random() * (PORT_RANGE.last - PORT_RANGE.first + 1));
    assertSafePort(port);
    if (await freePort(port)) return port;
  }
  throw new Error("no free port in 6810-6899");
}

/**
 * A `git archive` of the checkout at `sha` with `bench/` removed: no `.git`, so the owner cannot
 * `git show` the hidden tests or the decider's spec out of history.
 */
export async function makePluginCopy(throwaway: Throwaway, sha: string): Promise<void> {
  const copy = scratchDirectory(throwaway, "plugin");
  const archived = await run("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", throwaway.pluginSource, sha, copy]);
  if (archived.code !== 0) throw new Error(`git archive failed: ${archived.stderr}`);
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
    if (answered) break;
    if (attempt === 119) throw new Error("the daemon did not answer within a minute");
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  // The web port answers before the CLI treats the daemon as ready (its status says `not_ready`), and a plugin install in between fails.
  await waitForDaemonReady(() => run("paseo", ["daemon", "status", ...paseoArgs(throwaway), "--json"], { timeoutMs: 30_000 }), sleep);
}

type Runner = () => Promise<RunResult>;
const sleep = (milliseconds: number): Promise<void> => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

/** Polls `paseo daemon status --json` (through `status`) every 500 ms until `localDaemon` is `running`; fails with its text after `attempts`. */
export async function waitForDaemonReady(status: Runner, wait: (milliseconds: number) => Promise<void>, attempts = 240): Promise<void> {
  let last = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await status();
    last = (result.stdout || result.stderr).trim();
    try {
      if ((JSON.parse(result.stdout) as { localDaemon?: string }).localDaemon === "running") return;
    } catch {
      // not JSON yet: keep polling
    }
    await wait(500);
  }
  throw new Error(`the daemon was not ready after ${attempts} status checks: ${last}`);
}

/**
 * Runs the install up to three times, 10 s apart, retrying only a "not ready" failure; any other failure or a timeout fails at once.
 * The CLI's own 300 s wait for the daemon's answer is not a failure: the daemon goes on loading the plugin (4-5 minutes on a
 * busy host), and the caller polls the plugin until it answers.
 */
export async function installWithRetry(install: Runner, wait: (milliseconds: number) => Promise<void>): Promise<void> {
  const tries = 3;
  for (let attempt = 1; ; attempt += 1) {
    const installed = await install();
    if (installed.timedOut) throw new Error("paseo plugin install did not return within 10 minutes");
    if (installed.code === 0) return;
    const text = installed.stderr || installed.stdout;
    if (text.includes("Timeout waiting for message")) return;
    if (!text.includes("not ready") || attempt === tries) throw new Error(`paseo plugin install failed: ${text}`);
    await wait(10_000);
  }
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
  // Paseo loads the plugin before install returns, which took 2.5-3 minutes on a busy host: 180 s cut a run short.
  await installWithRetry(() => run("paseo", ["plugin", "install", throwaway.pluginCopy, ...paseoArgs(throwaway)], { timeoutMs: 600_000 }), sleep);
  // The plugin starts with the daemon's plugin host: ask it something until it answers.
  for (let attempt = 0; attempt < 600; attempt += 1) {
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
 * Stops the daemon, kills what is left by pid, and removes the plugin copy, the home and the scratch
 * folders by their literal paths. Safe to call twice. Returns what it found left over.
 */
export async function cleanup(throwaway: Throwaway, log: (line: string) => void = () => undefined): Promise<{ leftoverProcesses: string[]; removed: string[] }> {
  log("cleanup: stopping the daemon");
  if (throwaway.home !== "" && existsSync(throwaway.home)) await run("paseo", ["daemon", "stop", "--home", throwaway.home], { timeoutMs: 30_000 });
  if (throwaway.daemonPid !== null && alive(throwaway.daemonPid)) killGroup(throwaway.daemonPid);
  await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
  // Agents and the plugin host the daemon started are in its group or its home: find them by what they were started from.
  const found = await leftovers(throwaway);
  log(`cleanup: ${found.length} processes still running from the run`);
  for (const line of found) {
    const pid = Number(line.split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid !== process.pid && pid > 1) killGroup(pid, "SIGKILL");
  }
  startedPids().forEach(([pid]) => killGroup(pid, "SIGKILL"));
  if (throwaway.daemonPid !== null && alive(throwaway.daemonPid)) killGroup(throwaway.daemonPid, "SIGKILL");
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  const leftoverProcesses = await leftovers(throwaway);
  log("cleanup: removing the folders");
  const removed: string[] = [];
  if (throwaway.pluginCopy !== "") {
    // Unlink the shared node_modules first, so the removal below can never reach the checkout's.
    try {
      unlinkSync(join(throwaway.pluginCopy, "node_modules"));
    } catch {
      // no link made
    }
  }
  // The scratch repository has worktrees of its own (the owner's): removed with it, and its home too.
  [...new Set([...throwaway.folders, ...(throwaway.home === "" ? [] : [throwaway.home])])].forEach((path) => {
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
