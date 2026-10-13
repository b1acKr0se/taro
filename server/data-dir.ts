/**
 * Where this plugin keeps its own files: `$PASEO_HOME/plugin-data/taro/`.
 * Never under `$PASEO_HOME/plugins/taro/`, which is Paseo's install root and is
 * deleted whole by `paseo plugin remove`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const PLUGIN_ID = "taro";

export function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

export function pluginDataDirectory(): string {
  return join(paseoHome(), "plugin-data", PLUGIN_ID);
}

export function dataPath(entry: string): string {
  return join(pluginDataDirectory(), entry);
}

/** The plugin's own state files: parsed decisions, per-agent supervision state. */
export function statePath(entry: string): string {
  return join(pluginDataDirectory(), "state", entry);
}
