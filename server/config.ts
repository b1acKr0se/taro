/**
 * The daemon's global Taro config, `$PASEO_HOME/plugin-data/taro/config.json`:
 * where the Taro home is and which Paseo project groups the managers. Read on
 * every call, so a save takes effect at once.
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

import { dataPath } from "./data-dir";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import { serialized } from "./serialize";

export const GlobalConfigSchema = z.object({
  /** Empty means the default, `plugin-data/taro/home`. */
  taroHome: z.string().default(""),
  /** The Paseo project named "Taro" that holds every manager's workspace. */
  taroProjectId: z.string().default(""),
});
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

function configPath(): string {
  return dataPath("config.json");
}

export async function readGlobalConfig(): Promise<GlobalConfig> {
  const raw = await readJsonIfPresent(configPath());
  return GlobalConfigSchema.parse(raw ?? {});
}

export function updateGlobalConfig(patch: Partial<GlobalConfig>): Promise<GlobalConfig> {
  return serialized(configPath(), async () => {
    const next = GlobalConfigSchema.parse({ ...(await readGlobalConfig()), ...patch });
    await writeJsonAtomically(configPath(), next);
    return next;
  });
}

export function resolveTaroHome(config: GlobalConfig): string {
  const configured = config.taroHome.trim();
  if (configured === "") return dataPath("home");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
  if (!isAbsolute(configured)) throw new Error(`The Taro home must be an absolute path, not "${configured}".`);
  return resolve(configured);
}
