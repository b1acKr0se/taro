/**
 * Every command the benchmark runs: its own process group, killed whole on a timeout or at cleanup, and
 * a record of the pids it started so cleanup can check for leftovers. Runs under Node type stripping.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const started = new Map<number, string>();

export function startedPids(): [number, string][] {
  return [...started.entries()];
}

export function killGroup(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Runs a command to its end (or `timeoutMs`, then its group is killed). Never rejects. */
export function run(command: string, args: readonly string[], options: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number; input?: string } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    if (child.pid !== undefined) started.set(child.pid, `${command} ${args.slice(0, 3).join(" ")}`);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(options.input ?? "");
    const timer = options.timeoutMs === undefined ? null : setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) killGroup(child.pid, "SIGKILL");
    }, options.timeoutMs);
    child.on("error", (error) => {
      if (timer !== null) clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(error), timedOut });
    });
    child.on("close", (code) => {
      if (timer !== null) clearTimeout(timer);
      if (child.pid !== undefined) started.delete(child.pid);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Starts a long-lived command in its own group, output to a file descriptor; the caller kills it by pid. */
export function startDetached(command: string, args: readonly string[], options: { cwd?: string; env?: Record<string, string | undefined>; logFd: number }): ChildProcess {
  const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, detached: true, stdio: ["ignore", options.logFd, options.logFd] });
  if (child.pid !== undefined) started.set(child.pid, `${command} ${args.slice(0, 3).join(" ")}`);
  return child;
}
