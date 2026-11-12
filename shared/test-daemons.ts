/**
 * Throwaway Paseo daemons an owner starts to test a change (`taro daemon start <ID>`): where they may
 * live, and what stopping one leaves to kill. Owners forgot to stop them, and each holds threads the
 * host's agents need, so the plugin stops every recorded one when its ticket is Done or its owner is
 * archived. Pure and import-free: the `taro` command runs it under Node type stripping.
 */

/** The user's own daemon listens here; a test daemon never does. */
export const REAL_DAEMON_PORT = 6767;

/** Test ports, as the repository instructions pick them: 6810-6899. */
export const TEST_PORT_FIRST = 6810;
export const TEST_PORT_LAST = 6899;

/** One recorded test daemon. `pid` is its supervisor's, from `paseo.pid` in its home; null when it never wrote one. */
export interface DaemonRecord {
  home: string;
  port: number;
  pid: number | null;
  startedAt: string;
  /** The agent that started it, when one did. */
  startedBy: string | null;
}

export interface ProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
  sid: number;
  args: string;
}

/** `ps -eo pid=,ppid=,pgid=,sid=,args=` read into entries; lines that are not five fields are skipped. */
export function parseProcessTable(text: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    entries.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), sid: Number(match[4]), args: (match[5] ?? "").trim() });
  }
  return entries;
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function inside(parent: string, path: string): boolean {
  const root = withoutTrailingSlash(parent);
  const target = withoutTrailingSlash(path);
  return target === root || target.startsWith(`${root}/`);
}

/** A home the plugin may delete whole: a folder directly in /tmp named paseo-…, with no way out of it. */
export function isThrowawayHome(home: string): boolean {
  return /^\/tmp\/paseo-[A-Za-z0-9._-]+$/.test(withoutTrailingSlash(home)) && !home.includes("..");
}

/**
 * Why a test daemon may not use this home or port, or null. The user's daemon (its home, by default
 * `~/.paseo`, or `$PASEO_HOME` when set, and port 6767) runs every agent, this one included.
 */
export function daemonTargetRefusal(target: { home: string; port: number }, real: { userHome: string; paseoHome: string | null }): string | null {
  if (target.port === REAL_DAEMON_PORT) return `Port ${REAL_DAEMON_PORT} is the real Paseo daemon's: a test daemon never uses it.`;
  const realHomes = [`${withoutTrailingSlash(real.userHome)}/.paseo`, ...(real.paseoHome === null || real.paseoHome === "" ? [] : [real.paseoHome])];
  for (const realHome of realHomes) {
    if (inside(realHome, target.home) || inside(target.home, realHome)) {
      return `${target.home} is or holds the real Paseo daemon's home (${realHome}): a test daemon never uses it.`;
    }
  }
  if (!isThrowawayHome(target.home)) return `${target.home} is not a throwaway home: use a folder directly in /tmp named paseo-<something>.`;
  return null;
}

/** Whether the process at the record's pid is still that daemon: a pid the system gave to something else is not. */
function daemonAlive(record: DaemonRecord, processes: readonly ProcessEntry[]): boolean {
  if (record.pid === null) return false;
  const entry = processes.find((candidate) => candidate.pid === record.pid);
  return entry !== undefined && (/\bPaseo\b/i.test(entry.args) || entry.args.includes(record.home));
}

/**
 * What a daemon left running, to kill by pid: its session (the supervisor leads one, and a `git` its
 * plugin started keeps it after being reparented to PID 1) and anything naming its home. A session
 * counts only while the recorded pid is free or still the daemon: a reused pid leads someone else's.
 */
export function daemonLeftovers(record: DaemonRecord, processes: readonly ProcessEntry[], selfPid: number): number[] {
  const pidHolder = record.pid === null ? undefined : processes.find((entry) => entry.pid === record.pid);
  const ownSession = record.pid !== null && (pidHolder === undefined || daemonAlive(record, processes));
  const spared = lineage(selfPid, processes);
  return processes
    .filter((entry) => entry.pid > 1 && !spared.has(entry.pid))
    .filter((entry) => (ownSession && (entry.sid === record.pid || entry.pgid === record.pid)) || entry.args.includes(withoutTrailingSlash(record.home)))
    .map((entry) => entry.pid);
}

/** The process and its ancestors: whoever stops a daemon (an agent running in it, say) never kills itself. */
function lineage(pid: number, processes: readonly ProcessEntry[]): Set<number> {
  const chain = new Set<number>();
  let current: number | undefined = pid;
  while (current !== undefined && current > 1 && !chain.has(current)) {
    chain.add(current);
    const at: number = current;
    current = processes.find((entry) => entry.pid === at)?.ppid;
  }
  return chain;
}

export interface DaemonCleanupStep {
  record: DaemonRecord;
  /** Ask the daemon to stop (`paseo daemon stop --home`) before killing what is left. */
  stop: boolean;
  /** What to kill by pid, as the process table reads now. */
  kill: number[];
  /** Delete the home: it is a throwaway one. */
  removeHome: boolean;
}

/** For each recorded daemon: whether it still runs to stop, what to kill, whether its home goes. */
export function daemonCleanupPlan(records: readonly DaemonRecord[], processes: readonly ProcessEntry[], selfPid: number): DaemonCleanupStep[] {
  return records.map((record) => ({
    record,
    stop: daemonAlive(record, processes),
    kill: daemonLeftovers(record, processes, selfPid),
    removeHome: isThrowawayHome(record.home),
  }));
}

/** The recorded daemons in a record file's text; anything unreadable is none. */
export function parseDaemonRecords(text: string | null): DaemonRecord[] {
  if (text === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): DaemonRecord[] => {
    if (typeof item !== "object" || item === null) return [];
    const { home, port, pid, startedAt, startedBy } = item as Record<string, unknown>;
    if (typeof home !== "string" || typeof port !== "number") return [];
    return [{ home, port, pid: typeof pid === "number" ? pid : null, startedAt: typeof startedAt === "string" ? startedAt : "", startedBy: typeof startedBy === "string" ? startedBy : null }];
  });
}
