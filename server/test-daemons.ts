/**
 * Starting and stopping an owner's throwaway Paseo daemons (`taro daemon start|stop`), and the
 * plugin's stop of every one a ticket left when it is Done or its owner is archived. Each start is
 * recorded under the plugin data folder, `state/test-daemons/<project>/<ID>.json`, which is how the
 * plugin finds them. Plain Node, erasable TypeScript: the `taro` command reaches it.
 */
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

import {
  daemonCleanupPlan,
  daemonTargetRefusal,
  parseDaemonRecords,
  parseProcessTable,
  TEST_PORT_FIRST,
  TEST_PORT_LAST,
  type DaemonRecord,
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

/** Starts a throwaway daemon as the repository instructions do, and records it; throws with the reason when it cannot. */
export async function startTestDaemon(options: StartOptions): Promise<DaemonRecord> {
  if (options.home !== undefined || options.port !== undefined) {
    const refusal = daemonTargetRefusal({ home: options.home ?? `/tmp/paseo-${options.ticket}`, port: options.port ?? TEST_PORT_FIRST }, options.real);
    if (refusal !== null) throw new Error(refusal);
  }
  const port = options.port ?? (await freeTestPort());
  if (port === null) throw new Error(`No free port in ${TEST_PORT_FIRST}-${TEST_PORT_LAST}: stop a test daemon first (taro daemon stop).`);
  if (!(await portFree(port))) throw new Error(`Port ${port} is in use.`);
  const home = options.home ?? (await mkdtemp(`/tmp/paseo-${options.ticket}-`));
  const refusal = daemonTargetRefusal({ home, port }, options.real);
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
  const record: DaemonRecord = { home, port, pid, startedAt: new Date().toISOString(), startedBy: options.startedBy };
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

async function processTable(): Promise<ReturnType<typeof parseProcessTable>> {
  const result = await runCommand("ps", ["-eo", "pid=,ppid=,pgid=,sid=,args="], { timeoutMs: 15_000 });
  if (result.code !== 0) throw new Error(`ps failed: ${commandError(result)}`);
  return parseProcessTable(result.stdout);
}

export interface StoppedDaemon {
  record: DaemonRecord;
  /** The pids killed after the daemon's own stop. */
  killed: number[];
  problems: string[];
}

/**
 * Stops the recorded daemons (only the one at `home` when given): asks each to stop, kills by pid
 * what it left, deletes its throwaway home, and forgets it.
 */
export async function stopTestDaemons(options: { paseo: string; recordPath: string; home?: string }): Promise<StoppedDaemon[]> {
  const records = await readDaemonRecords(options.recordPath);
  const chosen = records.filter((record) => options.home === undefined || record.home === options.home);
  if (chosen.length === 0) return [];
  const problems = new Map<string, string[]>(chosen.map((record) => [record.home, []]));
  for (const step of daemonCleanupPlan(chosen, await processTable(), process.pid)) {
    if (!step.stop) continue;
    const stopped = await runCommand(options.paseo, ["daemon", "stop", "--home", step.record.home, "--force"], { timeoutMs: 40_000 }).catch((error: unknown) => ({
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    }));
    if (stopped.code !== 0) problems.get(step.record.home)?.push(`paseo daemon stop: ${commandError(stopped)}`);
  }
  const results: StoppedDaemon[] = [];
  for (const step of daemonCleanupPlan(chosen, await processTable(), process.pid)) {
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
    results.push({ record: step.record, killed, problems: problems.get(step.record.home) ?? [] });
  }
  const remaining = await readDaemonRecords(options.recordPath);
  await writeDaemonRecords(options.recordPath, remaining.filter((record) => !chosen.some((gone) => gone.home === record.home)));
  return results;
}
