/**
 * Which providers replace a running turn rather than take a message mid-turn (TR-084), from Paseo's
 * own config: a custom provider extending an ACP one (`"gemini": { "extends": "acp" }`) does, and only
 * the config says so. Read again when the file changes.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { REPLACING_PROVIDERS, replacingProviders } from "../shared/pending-sends";
import { paseoHome } from "./data-dir";

let cached: { path: string; modifiedAt: number; replacing: ReadonlySet<string> } | null = null;

/** The replacing providers; the built-in list when Paseo's config cannot be read. */
export async function readReplacingProviders(configPath: string = join(paseoHome(), "config.json")): Promise<ReadonlySet<string>> {
  try {
    const modifiedAt = (await stat(configPath)).mtimeMs;
    if (cached !== null && cached.path === configPath && cached.modifiedAt === modifiedAt) return cached.replacing;
    const replacing = replacingProviders(JSON.parse(await readFile(configPath, "utf8")));
    cached = { path: configPath, modifiedAt, replacing };
    return replacing;
  } catch {
    return REPLACING_PROVIDERS;
  }
}
