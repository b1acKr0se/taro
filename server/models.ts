/** Provider and model ids, and the provider's bypass permission mode. */
import { isBypassMode } from "../shared/permission-triage";
import type { PaseoApi } from "./host-types";

export function providerOf(model: string): string {
  const slash = model.indexOf("/");
  return slash === -1 ? model : model.slice(0, slash);
}

/** The mode id that skips permission prompts for this provider (decision 30), or null when it has none. */
export async function bypassModeId(paseo: PaseoApi, model: string): Promise<string | null> {
  try {
    const result = await paseo.providers.listModes(providerOf(model));
    const modes: unknown = Reflect.get(result as object, "modes");
    if (!Array.isArray(modes)) return null;
    const ids = modes
      .map((mode: unknown) => (typeof mode === "object" && mode !== null ? Reflect.get(mode, "id") : null))
      .filter((id): id is string => typeof id === "string");
    return ids.find((id) => id === "bypassPermissions") ?? ids.find(isBypassMode) ?? null;
  } catch {
    return null;
  }
}

/** The bypass mode id for a provider, for agents launched from the CLI (no lookup available there). */
export function knownBypassMode(model: string): string {
  const provider = providerOf(model);
  if (provider === "claude") return "bypassPermissions";
  if (provider === "codex") return "full-access";
  return "";
}
