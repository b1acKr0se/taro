/**
 * Starting and stopping an owner's throwaway Paseo daemons (`taro daemon start|stop`), and the
 * plugin's stop of every one a ticket left when it is Done or its owner is archived. Each start is
 * recorded under the plugin data folder, `state/test-daemons/<project>/<ID>.json`, which is how the
 * plugin finds them. Plain Node, erasable TypeScript: the `taro` command reaches it.
 */
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";

import {
  daemonCleanupPlan,
  daemonTargetRefusal,
  parseDaemonRecords,
  parseProcessTable,
  psStartTime,
  realDaemonHomes,
  REAL_DAEMON_PORT,
  TEST_PORT_FIRST,
  TEST_PORT_LAST,
  type DaemonRecord,
  type HomeKind,
  type ProcessEntry,
} from "../shared/test-daemons.ts";
import { commandError, runCommand } from "./process.ts";

export function daemonRecordPath(dataDirectory: string, project: string, ticket: string): string {
  return join(dataDirectory, "state", "test-daemons", project, `${ticket.toUpperCase()}.json`);
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function readDaemonRecords(path: string): Promise<DaemonRecord[]> {
  return parseDaemonRecords(await readText(path));
}

async function writeDaemonRecords(path: string, records: readonly DaemonRecord[]): Promise<void> {
  if (records.length === 0) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`);
  await rename(temporary, path);
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function freeTestPort(): Promise<number | null> {
  const ports = Array.from({ length: TEST_PORT_LAST - TEST_PORT_FIRST + 1 }, (_, index) => TEST_PORT_FIRST + index).sort(() => Math.random() - 0.5);
  for (const port of ports) if (await portFree(port)) return port;
  return null;
}

export interface RealDaemon {
  userHome: string;
  paseoHome: string | null;
}

export interface StartOptions {
  paseo: string;
  recordPath: string;
  ticket: string;
  real: RealDaemon;
  home?: string;
  port?: number;
  /** A plugin folder to install into the new daemon (`paseo plugin install`). */
  plugin?: string;
  startedBy: string | null;
}

/** The path with every symlink on its way resolved; the part that does not exist yet is kept as written. */
async function resolveThrough(path: string): Promise<string> {
  const absolute = resolve(path);
  const missing: string[] = [];
  for (let existing = absolute; ; existing = dirname(existing)) {
    try {
      return join(await realpath(existing), ...missing.reverse());
    } catch {
      if (dirname(existing) === existing) return absolute;
      missing.push(basename(existing));
    }
  }
}

async function homeKind(home: string): Promise<HomeKind> {
  try {
    const status = await lstat(home);
    if (status.isSymbolicLink()) return "symlink";
    if (!status.isDirectory()) return "not-folder";
    return (await readdir(home)).length === 0 ? "empty" : "not-empty";
  } catch {
    return "missing";
  }
}

/** Why a test daemon may not use this home and port, looking at the disk: links resolved, the real homes too. */
export async function targetRefusal(home: string, port: number, real: RealDaemon): Promise<string | null> {
  const realHomes = await Promise.all(realDaemonHomes(real).map(async (path) => [path, await resolveThrough(path)]));
  return daemonTargetRefusal({ home, port, resolvedHome: await resolveThrough(home), kind: await homeKind(home) }, [...new Set(realHomes.flat())]);
}

/**
 * The process's start time as `ps -o lstart=` prints it, or null when it is gone or `ps` cannot say.
 * `ps` rather than `/proc`, which macOS lacks; the C locale keeps the text the same whoever runs it.
 */
export async function startTimeOf(pid: number): Promise<string | null> {
  const result = await runCommand("ps", ["-o", "lstart=", "-p", String(pid)], { timeoutMs: 15_000, env: { LC_ALL: "C" } }).catch(() => null);
  return result === null || result.code !== 0 ? null : psStartTime(result.stdout);
}

/** Starts a throwaway daemon as the repository instructions do, and records it; throws with the reason when it cannot. */
export async function startTestDaemon(options: StartOptions): Promise<DaemonRecord> {
  if (options.port === REAL_DAEMON_PORT) throw new Error(`Port ${REAL_DAEMON_PORT} is the real Paseo daemon's: a test daemon never uses it.`);
  if (options.home !== undefined) {
    const refusal = await targetRefusal(options.home, options.port ?? TEST_PORT_FIRST, options.real);
    if (refusal !== null) throw new Error(refusal);
  }
  const port = options.port ?? (await freeTestPort());
  if (port === null) throw new Error(`No free port in ${TEST_PORT_FIRST}-${TEST_PORT_LAST}: stop a test daemon first (taro daemon stop).`);
  if (!(await portFree(port))) throw new Error(`Port ${port} is in use.`);
  const home = options.home ?? (await mkdtemp(`/tmp/paseo-${options.ticket}-`));
  const refusal = await targetRefusal(home, port, options.real);
  if (refusal !== null) throw new Error(refusal);
  await mkdir(home, { recursive: true });
  const config = { version: 1, daemon: { listen: `127.0.0.1:${port}` }, pluginsEnabled: true, features: { webUi: { enabled: true } } };
  await writeFile(join(home, "config.json"), `${JSON.stringify(config)}\n`);
  const started = await runCommand(options.paseo, ["daemon", "start", "--home", home, "--timeout", "120"], { timeoutMs: 150_000, env: { PASEO_HOME: home } });
  const pidFile = await readText(join(home, "paseo.pid"));
  let pid: number | null = null;
  try {
    const value = pidFile === null ? null : (JSON.parse(pidFile) as { pid?: unknown });
    pid = typeof value?.pid === "number" ? value.pid : null;
  } catch {
    pid = null;
  }
  const startTime = pid === null ? null : await startTimeOf(pid);
  const record: DaemonRecord = { home, port, pid, startTime, startedAt: new Date().toISOString(), startedBy: options.startedBy };
  // Recorded before anything else can fail, so a half-started daemon is still stopped later.
  await writeDaemonRecords(options.recordPath, [...(await readDaemonRecords(options.recordPath)), record]);
  if (started.code !== 0) {
    await stopTestDaemons({ paseo: options.paseo, recordPath: options.recordPath, home });
    throw new Error(`paseo daemon start failed: ${commandError(started)}`);
  }
  if (options.plugin !== undefined) {
    const installed = await runCommand(options.paseo, ["plugin", "install", options.plugin, "--home", home], { timeoutMs: 120_000 });
    if (installed.code !== 0) throw new Error(`The daemon runs (home ${home}, port ${port}), but paseo plugin install failed: ${commandError(installed)}`);
  }
  return record;
}

/** The process table, with the start time of each recorded daemon's pid that still runs. */
async function processTable(records: readonly DaemonRecord[]): Promise<ProcessEntry[]> {
  const result = await runCommand("ps", ["-eo", "pid=,ppid=,pgid=,sid=,args="], { timeoutMs: 15_000 });
  if (result.code !== 0) throw new Error(`ps failed: ${commandError(result)}`);
  const recorded = new Set(records.flatMap((record) => (record.pid === null ? [] : [record.pid])));
  return Promise.all(
    parseProcessTable(result.stdout).map(async (entry) => {
      if (!recorded.has(entry.pid)) return entry;
      return { ...entry, startTime: await startTimeOf(entry.pid) };
    }),
  );
}

export interface StoppedDaemon {
  record: DaemonRecord;
  /**
   * `stopped`: it ran and was asked to stop; `not-running`: it no longer ran, its leftovers and home
   * were cleared; `kept`: whether its pid is still it could not be told, so nothing was touched and
   * the record and home stay until that pid exits.
   */
  outcome: "stopped" | "not-running" | "kept";
  /** The pids killed after the daemon's own stop. */
  killed: number[];
  problems: string[];
}

/**
 * Stops the recorded daemons (only the one at `home` when given): asks each to stop, kills by pid
 * what it left, deletes its throwaway home, and forgets it. One whose pid cannot be told apart from
 * a reused one (no start time) is kept, untouched.
 */
export async function stopTestDaemons(options: { paseo: string; recordPath: string; home?: string }): Promise<StoppedDaemon[]> {
  const records = await readDaemonRecords(options.recordPath);
  const chosen = records.filter((record) => options.home === undefined || record.home === options.home);
  if (chosen.length === 0) return [];
  const problems = new Map<string, string[]>(chosen.map((record) => [record.home, []]));
  const askedToStop = new Set<string>();
  for (const step of daemonCleanupPlan(chosen, await processTable(chosen), process.pid)) {
    if (!step.stop) continue;
    askedToStop.add(step.record.home);
    const stopped = await runCommand(options.paseo, ["daemon", "stop", "--home", step.record.home, "--force"], { timeoutMs: 40_000 }).catch((error: unknown) => ({
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }));
    if (stopped.code !== 0) problems.get(step.record.home)?.push(`paseo daemon stop: ${commandError(stopped)}`);
  }
  const results: StoppedDaemon[] = [];
  const kept = new Set<string>();
  for (const step of daemonCleanupPlan(chosen, await processTable(chosen), process.pid)) {
    if (step.keep) {
      kept.add(step.record.home);
      const reason = step.record.startTime === null ? "its start time was not read when it started" : `the start time of pid ${step.record.pid} could not be read now`;
      results.push({ record: step.record, outcome: "kept", killed: [], problems: [...(problems.get(step.record.home) ?? []), `kept: ${reason}, so pid ${step.record.pid} may be another process; the record and home stay until it exits`] });
      continue;
    }
    const killed: number[] = [];
    for (const pid of step.kill) {
      try {
        process.kill(pid, "SIGKILL");
        killed.push(pid);
      } catch {
        // Gone between the read and the kill.
      }
    }
    if (step.removeHome) await rm(step.record.home, { recursive: true, force: true }).catch((error: unknown) => problems.get(step.record.home)?.push(`removing the home: ${String(error)}`));
    results.push({ record: step.record, outcome: askedToStop.has(step.record.home) ? "stopped" : "not-running", killed, problems: problems.get(step.record.home) ?? [] });
  }
  const remaining = await readDaemonRecords(options.recordPath);
  await writeDaemonRecords(options.recordPath, remaining.filter((record) => kept.has(record.home) || !chosen.some((gone) => gone.home === record.home)));
  return results;
}

/** What happened to one recorded daemon, in words: never "stopped" unless it ran and was asked to stop. */
export function stoppedDaemonLine(ticket: string, stopped: StoppedDaemon, reason?: string): string {
  const which = `${ticket}'s test daemon ${stopped.record.home} (port ${stopped.record.port})`;
  const because = reason === undefined ? "" : ` because ${reason}`;
  const problems = stopped.problems.length === 0 ? "" : `; ${stopped.problems.join("; ")}`;
  if (stopped.outcome === "kept") return `did not stop ${which}${because}: stopped nothing${problems}`;
  const killed = stopped.killed.length === 0 ? "nothing left to kill" : `killed ${stopped.killed.join(", ")}`;
  if (stopped.outcome === "not-running") return `cleared ${which}, which no longer ran,${because}: ${killed}${problems}`;
  return `stopped ${which}${because}: ${killed}${problems}`;
}
