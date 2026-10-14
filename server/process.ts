/**
 * Running a command on the daemon host: git, the Backlog CLI, the paseo CLI.
 * Arguments are passed as argv, never through a shell.
 *
 * Each command starts in its own process group, and a timeout or the plugin's stop kills the whole
 * group (TR-073): `backlog` is a Node wrapper that starts the native binary, and killing only the
 * wrapper left the binary running under init, holding its threads, whenever it hung.
 */
import { spawn, type ChildProcess } from "node:child_process";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** Within Paseo's two seconds between asking a plugin to stop and SIGTERM. */
export const STOP_GRACE_MS = 1_500;

/** Windows has no process groups to signal; there the command itself is killed. */
const GROUPS = process.platform !== "win32";

/** Commands still running, until their streams close. */
const running = new Set<ChildProcess>();
let stopped = false;
let exitHooked = false;

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (GROUPS) process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    // Already gone.
  }
}

function killAll(): void {
  for (const child of running) killGroup(child);
}

export function runCommand(command: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    if (stopped) {
      reject(new Error(`${command} ${args[0] ?? ""} not started: Taro is stopping`));
      return;
    }
    if (!exitHooked) {
      // A plugin process that exits without a stop still takes its commands with it.
      process.once("exit", killAll);
      exitHooked = true;
    }
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      detached: GROUPS,
      windowsHide: true,
    });
    running.add(child);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      killGroup(child);
      reject(new Error(`${command} ${args[0] ?? ""} did not finish within ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      running.delete(child);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      running.delete(child);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * The plugin's stop: no new command starts, those under way get `graceMs` to finish (a git commit
 * killed halfway leaves its index lock behind), then what is left is killed with its children.
 */
export async function stopCommands(graceMs: number = STOP_GRACE_MS): Promise<void> {
  stopped = true;
  const deadline = Date.now() + graceMs;
  while (running.size > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  killAll();
}

/** How many commands are under way. */
export function runningCommands(): number {
  return running.size;
}

/** For tests: commands may start again. */
export function resumeCommands(): void {
  stopped = false;
}

/** Runs `work` with at most `limit` of them under way at once; the rest wait their turn in order. */
export function concurrencyLimit(limit: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (work) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await work();
    } finally {
      // The slot passes straight to the next in line, so `active` counts it throughout.
      const next = waiting.shift();
      if (next === undefined) active--;
      else next();
    }
  };
}

/** The command's complaint: its first non-empty stderr line, else stdout's, else the exit code. */
export function commandError(result: CommandResult): string {
  for (const stream of [result.stderr, result.stdout]) {
    const text = stream.trim();
    if (text !== "") return text.split("\n")[0] ?? text;
  }
  return `exit ${result.code}`;
}

/** Runs and throws on a non-zero exit; returns stdout. */
export async function runChecked(command: string, args: readonly string[], options: CommandOptions = {}): Promise<string> {
  const result = await runCommand(command, args, options);
  if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${commandError(result)}`);
  return result.stdout;
}
