/**
 * The `paseo` CLI, for what the plugin SDK does not offer: creating and
 * renaming projects, stopping a turn when the daemon's websocket cannot be
 * used (`daemon-cancel.ts`), and finding where the plugin is installed. Adapted from FirstMate's `server/cli.ts` (MIT).
 */
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { paseoHome } from "./data-dir";
import { cancelOverSocket, DirectCancelUnavailable } from "./daemon-cancel";
import { commandError, runCommand, type CommandResult } from "./process";

/** Where an install puts the binary, for a daemon started with a bare PATH. */
const EXTRA_CLI_DIRECTORIES = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"];

let cliLookup: Promise<string | null> | null = null;

async function findCli(): Promise<string | null> {
  const onPath = (process.env.PATH ?? "").split(delimiter).filter((directory) => directory !== "");
  const shipped = process.env.PASEO_CLI?.trim();
  const candidates = [
    ...(shipped === undefined || shipped === "" ? [] : [shipped]),
    ...[...onPath, join(homedir(), ".local", "bin"), ...EXTRA_CLI_DIRECTORIES].map((directory) => join(directory, "paseo")),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here; try the next one.
    }
  }
  return null;
}

/** The CLI's absolute path, looked up once per plugin process. */
export function paseoCli(): Promise<string | null> {
  cliLookup ??= findCli();
  return cliLookup;
}

async function requireCli(purpose: string): Promise<string> {
  const cli = await paseoCli();
  if (cli === null) throw new Error(`The \`paseo\` command is not on the daemon's PATH, so ${purpose}.`);
  return cli;
}

/** Runs `paseo <args> --home <this daemon's home> --json` and parses its output. */
export async function runPaseoJson(args: readonly string[], purpose: string): Promise<unknown> {
  const cli = await requireCli(purpose);
  const result = await runCommand(cli, [...args, "--home", paseoHome(), "--json"], { timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error(`paseo ${args[0] ?? ""} failed: ${paseoJsonError(result)}`);
  const text = result.stdout.trim();
  return text === "" ? null : (JSON.parse(text) as unknown);
}

/** Why a `--json` command failed: the `{"error":{"message"}}` it prints on stderr (shown to the user, TR-072), else the first line of output. */
export function paseoJsonError(result: CommandResult): string {
  for (const stream of [result.stderr, result.stdout]) {
    try {
      const parsed: unknown = JSON.parse(stream);
      const error: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "error") : null;
      const message: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "message") : null;
      if (typeof message === "string" && message.trim() !== "") return message.trim();
    } catch {
      // Not JSON: the plain output says it.
    }
  }
  return commandError(result);
}

export async function createProject(path: string): Promise<{ projectId: string }> {
  const created = await runPaseoJson(["project", "create", path], "a project cannot be registered");
  const projectId: unknown = typeof created === "object" && created !== null ? Reflect.get(created, "projectId") : null;
  if (typeof projectId !== "string") throw new Error("paseo project create did not return a project id.");
  return { projectId };
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  await runPaseoJson(["project", "rename", projectId, name], "a project cannot be renamed");
}

/** Straight over the daemon's websocket (TR-201); through `paseo stop` when that route cannot be used. */
export async function stopAgent(agentId: string): Promise<void> {
  try {
    await cancelOverSocket(agentId, { home: paseoHome() });
    return;
  } catch (error) {
    if (!(error instanceof DirectCancelUnavailable)) throw error;
    console.warn(`[taro] stopping ${agentId} through the CLI: ${error.message}`);
  }
  await runPaseoJson(["stop", agentId], "a turn cannot be interrupted");
}

/** The directory `paseo plugin ls --json` lists for a plugin. */
export function pluginPathIn(listing: unknown, pluginId: string): string | null {
  if (!Array.isArray(listing)) return null;
  const entry: unknown = listing.find(
    (plugin: unknown) => typeof plugin === "object" && plugin !== null && Reflect.get(plugin, "id") === pluginId,
  );
  const path: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "path") : null;
  return typeof path === "string" && path !== "" ? path : null;
}

export async function pluginDirectory(pluginId: string): Promise<string> {
  const listing = await runPaseoJson(["plugin", "ls"], "the plugin cannot find its own files");
  const path = pluginPathIn(listing, pluginId);
  if (path === null) throw new Error(`paseo plugin ls does not list a directory for ${pluginId}.`);
  return path;
}
