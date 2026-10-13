/**
 * Running a command on the daemon host: git, the Backlog CLI, the paseo CLI.
 * Arguments are passed as argv, never through a shell.
 */
import { spawn } from "node:child_process";

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

export function runCommand(command: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args[0] ?? ""} did not finish within ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
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
