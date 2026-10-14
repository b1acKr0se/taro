/**
 * Backlog.md for a first run (TR-063): when no `backlog` is installed, Taro installs a pinned
 * version into its own data folder with `npm install --prefix`, never globally and never with sudo.
 * An install can outlast Paseo's 60-second RPC timeout, so it runs in the background and the setup
 * page polls its state.
 */
import { access, constants, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { dataPath } from "./data-dir";
import { commandError, runCommand, type CommandOptions, type CommandResult } from "./process";

/** The only place the pinned version is written. */
export const BACKLOG_VERSION = "1.53.0";

export const NODE_DOWNLOAD_URL = "https://nodejs.org/";

/** Where a daemon started with a bare PATH may still find a command. */
const USUAL_DIRECTORIES = [join(homedir(), ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"];

const INSTALL_TIMEOUT_MS = 10 * 60_000;

export function toolsDirectory(): string {
  return dataPath("tools");
}

/** Where npm links Taro's copy of the CLI. */
export function taroBacklogDirectory(): string {
  return join(toolsDirectory(), "node_modules", ".bin");
}

export function taroBacklogPath(): string {
  return join(taroBacklogDirectory(), "backlog");
}

/** The PATH's directories, then the usual install places. */
export function searchDirectories(): string[] {
  const onPath = (process.env.PATH ?? "").split(delimiter).filter((directory) => directory !== "");
  return [...onPath, ...USUAL_DIRECTORIES];
}

export async function findExecutable(name: string, directories: readonly string[]): Promise<string | null> {
  for (const directory of directories) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

/**
 * npm, looked for next to the Node running the daemon too: a desktop app's daemon often has a PATH
 * without it. Both npm and the installed CLI start with `#!/usr/bin/env node`, so that Node's
 * folder goes first on their PATH.
 */
export function nodeDirectory(): string {
  return dirname(process.execPath);
}

export function withNodeOnPath(): Record<string, string> {
  return { PATH: [nodeDirectory(), process.env.PATH ?? ""].filter((part) => part !== "").join(delimiter) };
}

/** What running `binary` needs: Taro's copy is a Node script, so it gets the daemon's Node. */
export function backlogEnvironment(binary: string): Record<string, string> {
  return dirname(binary) === taroBacklogDirectory() ? withNodeOnPath() : {};
}

export function findNpm(): Promise<string | null> {
  return findExecutable("npm", [...searchDirectories(), nodeDirectory()]);
}

export type InstallPhase = "idle" | "running" | "failed" | "done";

export interface InstallState {
  phase: InstallPhase;
  /** What is happening now, while running. */
  step: string | null;
  /** Why it failed, in words for the user. */
  error: string | null;
  /** The installed version's report, once done. */
  version: string | null;
}

const NETWORK_CODES = ["ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "ERR_SOCKET_TIMEOUT", "UNABLE_TO_GET_ISSUER_CERT", "SELF_SIGNED_CERT"];

/** Turns a failed `npm install`'s output into what the user is told. */
export function describeNpmFailure(result: CommandResult): string {
  const output = `${result.stderr}\n${result.stdout}`;
  const manual = `You can also install it yourself: npm i -g backlog.md@${BACKLOG_VERSION}`;
  if (NETWORK_CODES.some((code) => output.includes(code)) || /network|offline|registry\.npmjs\.org.*fail/i.test(output)) {
    return `Could not reach the npm registry. Check this machine's internet connection (or npm proxy settings) and try again. ${manual}`;
  }
  if (/E404|ETARGET|No matching version/i.test(output)) {
    return `The npm registry has no backlog.md ${BACKLOG_VERSION}. ${manual}`;
  }
  if (/EACCES|EPERM/.test(output)) {
    return `npm was not allowed to write to ${toolsDirectory()}. ${manual}`;
  }
  return `npm could not install Backlog.md: ${npmErrorLine(output) ?? commandError(result)}`;
}

/**
 * npm's first message line, with its code alongside: npm prints `code`, `errno`, `syscall` and `path`
 * lines first, and a bare code such as E500 or ENOSPC tells the user nothing.
 */
function npmErrorLine(output: string): string | null {
  let code: string | null = null;
  let message: string | null = null;
  for (const line of output.split("\n")) {
    const text = /^npm (?:ERR!|error)\s+(.+)$/.exec(line.trim())?.[1]?.trim();
    if (text === undefined || text === "") continue;
    const detail = /^(code|errno|syscall|path|dest)\s+(.+)$/.exec(text);
    if (detail !== null) {
      if (detail[1] === "code") code ??= detail[2]?.trim() ?? null;
    } else if (!/^A complete log of this run/i.test(text)) {
      message ??= text;
    }
  }
  if (message === null) return code;
  return code === null || message.includes(code) ? message : `${message} (${code})`;
}

export interface InstallDependencies {
  findNpm: () => Promise<string | null>;
  run: (command: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>;
  /** Called once Taro's copy works, so the next lookup finds it. */
  installed: () => void;
}

const defaultDependencies: InstallDependencies = { findNpm, run: runCommand, installed: () => undefined };

/** One install at a time per plugin process; the state outlives the page that started it. */
export function createBacklogInstaller(dependencies: InstallDependencies = defaultDependencies) {
  let state: InstallState = { phase: "idle", step: null, error: null, version: null };
  let running: Promise<void> | null = null;

  const fail = (error: string) => {
    state = { phase: "failed", step: null, error, version: null };
  };

  async function install(): Promise<void> {
    const npm = await dependencies.findNpm();
    if (npm === null) {
      fail(`npm was not found on this machine, and Taro installs Backlog.md with it. Install Node.js (which includes npm) from ${NODE_DOWNLOAD_URL}, then press Install again.`);
      return;
    }
    const tools = toolsDirectory();
    await mkdir(tools, { recursive: true });
    const env = withNodeOnPath();
    state = { ...state, step: `Downloading backlog.md ${BACKLOG_VERSION} with npm…` };
    const result = await dependencies.run(
      npm,
      ["install", "--prefix", tools, `backlog.md@${BACKLOG_VERSION}`, "--no-audit", "--no-fund", "--no-update-notifier", "--loglevel", "error"],
      { cwd: tools, env, timeoutMs: INSTALL_TIMEOUT_MS },
    );
    if (result.code !== 0) {
      fail(describeNpmFailure(result));
      return;
    }
    state = { ...state, step: "Checking the installed copy…" };
    const check = await dependencies.run(taroBacklogPath(), ["--version"], { env, timeoutMs: 30_000 });
    const version = check.stdout.trim().split("\n")[0] ?? "";
    if (check.code !== 0 || version === "") {
      fail(`Backlog.md was installed but does not run: ${commandError(check)}`);
      return;
    }
    dependencies.installed();
    state = { phase: "done", step: null, error: null, version };
  }

  return {
    state: (): InstallState => state,
    /** Starts an install unless one is running; returns the state at once. */
    start(): InstallState {
      if (running === null) {
        state = { phase: "running", step: "Looking for npm…", error: null, version: null };
        running = install()
          .catch((error: unknown) => fail(`Installing Backlog.md failed: ${error instanceof Error ? error.message : String(error)}`))
          .finally(() => {
            running = null;
          });
      }
      return state;
    },
    /** Settles when the current install does; for tests. */
    settled: (): Promise<void> => running ?? Promise.resolve(),
  };
}

export type BacklogInstaller = ReturnType<typeof createBacklogInstaller>;
