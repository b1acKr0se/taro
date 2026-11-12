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
  /**
   * That process's start time (field 22 of `/proc/<pid>/stat`), read when it started: a pid the system
   * gave to another process has another start time. Null when unread (an older record, no `/proc`).
   */
  startTime: string | null;
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
  /** Field 22 of `/proc/<pid>/stat`, read only for recorded pids; absent otherwise. */
  startTime?: string;
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

/** The start time (field 22) in a `/proc/<pid>/stat` text, or null. The command name may hold spaces and parentheses, so fields count from the last `)`. */
export function procStartTime(stat: string): string | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const field = stat.slice(close + 1).trim().split(/\s+/)[22 - 3];
  return field !== undefined && /^\d+$/.test(field) ? field : null;
}

/** Whether the arguments name this home, not one that only starts with it: `/tmp/paseo-TR-1` is not in `/tmp/paseo-TR-12`. */
export function namesHome(args: string, home: string): boolean {
  const root = withoutTrailingSlash(home);
  if (root === "") return false;
  for (let at = args.indexOf(root); at >= 0; at = args.indexOf(root, at + 1)) {
    const next = args[at + root.length];
    if (next === undefined || next === "/" || /\s/.test(next)) return true;
  }
  return false;
}

/** A home the plugin may delete whole: a folder directly in /tmp named paseo-…, with no way out of it. */
export function isThrowawayHome(home: string): boolean {
  return /^\/tmp\/paseo-[A-Za-z0-9._-]+$/.test(withoutTrailingSlash(home)) && !home.includes("..");
}

/** The user's daemon's home as configured: `~/.paseo`, and `$PASEO_HOME` when set. */
export function realDaemonHomes(real: { userHome: string; paseoHome: string | null }): string[] {
  return [`${withoutTrailingSlash(real.userHome)}/.paseo`, ...(real.paseoHome === null || real.paseoHome === "" ? [] : [real.paseoHome])];
}

/** What is at a home path now: a symlink or a folder with files in it is never taken over. */
export type HomeKind = "missing" | "empty" | "not-empty" | "symlink" | "not-folder";

export interface DaemonTarget {
  home: string;
  port: number;
  /** The home with every symlink on its way resolved (for a new home, its parent's real path plus its name). */
  resolvedHome: string;
  kind: HomeKind;
}

/**
 * Why a test daemon may not use this home or port, or null. The user's daemon (its home, by default
 * `~/.paseo`, or `$PASEO_HOME` when set, and port 6767) runs every agent, this one included. Paths
 * are compared as written and resolved, so a `/tmp/paseo-x` that is a link to `~/.paseo` is refused;
 * `realHomes` holds both forms of each real home.
 */
export function daemonTargetRefusal(target: DaemonTarget, realHomes: readonly string[]): string | null {
  if (target.port === REAL_DAEMON_PORT) return `Port ${REAL_DAEMON_PORT} is the real Paseo daemon's: a test daemon never uses it.`;
  for (const realHome of realHomes) {
    for (const path of [target.home, target.resolvedHome]) {
      if (inside(realHome, path) || inside(path, realHome)) {
        return `${target.home} is or holds the real Paseo daemon's home (${realHome}): a test daemon never uses it.`;
      }
    }
  }
  if (target.kind === "symlink") return `${target.home} is a symbolic link: a test daemon's home is a real folder.`;
  if (target.kind === "not-folder") return `${target.home} exists and is not a folder.`;
  if (target.kind === "not-empty") return `${target.home} already holds files: a test daemon starts in a new or empty folder.`;
  if (!isThrowawayHome(target.home)) return `${target.home} is not a throwaway home: use a folder directly in /tmp named paseo-<something>.`;
  return null;
}

/**
 * Whether the process at the record's pid is still that daemon: same pid and same start time. A pid the
 * system gave to something else (even another Paseo daemon) is not, nor is any pid of a record without a start time.
 */
function daemonAlive(record: DaemonRecord, processes: readonly ProcessEntry[]): boolean {
  if (record.pid === null || record.startTime === null) return false;
  const entry = processes.find((candidate) => candidate.pid === record.pid);
  return entry !== undefined && entry.startTime === record.startTime;
}

/**
 * What a daemon left running, to kill by pid: its session (the supervisor leads one, and a `git` its
 * plugin started keeps it after being reparented to PID 1) and anything naming its home. A session
 * counts only while the recorded pid is free or still the daemon (its start time matches): a reused pid
 * leads someone else's. A record without a start time kills only what names its home.
 */
export function daemonLeftovers(record: DaemonRecord, processes: readonly ProcessEntry[], selfPid: number): number[] {
  const pidHolder = record.pid === null ? undefined : processes.find((entry) => entry.pid === record.pid);
  const ownSession = record.pid !== null && record.startTime !== null && (pidHolder === undefined || daemonAlive(record, processes));
  const spared = lineage(selfPid, processes);
  return processes
    .filter((entry) => entry.pid > 1 && !spared.has(entry.pid))
    .filter((entry) => (ownSession && (entry.sid === record.pid || entry.pgid === record.pid)) || namesHome(entry.args, record.home))
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
    const { home, port, pid, startTime, startedAt, startedBy } = item as Record<string, unknown>;
    if (typeof home !== "string" || typeof port !== "number") return [];
    return [{ home, port, pid: typeof pid === "number" ? pid : null, startTime: typeof startTime === "string" ? startTime : null, startedAt: typeof startedAt === "string" ? startedAt : "", startedBy: typeof startedBy === "string" ? startedBy : null }];
  });
}
