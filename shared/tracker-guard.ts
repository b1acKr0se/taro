/**
 * What the plugin refuses to commit to a tracker (TR-051): a `backlog init`
 * run by mistake against the live tracker renames the project in
 * `backlog/config.yml` and writes Backlog's guidelines into the agent
 * instruction files at the tracker's root. Pure: the caller reads the committed
 * and the working copies and restores what this flags.
 */
import type { BoardAlert } from "./recovery";

/** The config keys that name the tracker's project and its ticket ids; Taro sets them at onboarding. */
export const IDENTITY_KEYS = ["project_name", "task_prefix", "zero_padded_ids"] as const;

export const TRACKER_CONFIG = "backlog/config.yml";

/** The instruction files `backlog init` may write at a project's root, relative to it. */
export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md"] as const;

/** A protection alert stays on the board this long after the last refusal, unless dismissed. */
export const PROTECTION_ALERT_MS = 24 * 60 * 60 * 1000;

export const PROTECTION_ALERT_ID = "tracker-protected";

/** A top-level `key: value` from Backlog's flat YAML config, without quotes; null when absent. */
function configValue(configText: string, key: string): string | null {
  const match = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, "m").exec(configText);
  if (match === null || match[1] === undefined) return null;
  const value = match[1];
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

/** Each identity key whose value differs between the committed and the working config, as `project_name "taro" → "scratch"`. */
export function identityChanges(committedText: string, workingText: string): string[] {
  return IDENTITY_KEYS.flatMap((key) => {
    const before = configValue(committedText, key);
    const after = configValue(workingText, key);
    return before === after ? [] : [`${key} ${shown(before)} → ${shown(after)}`];
  });
}

function shown(value: string | null): string {
  return value === null ? "(none)" : JSON.stringify(value);
}

const GUIDELINES_BLOCK = /<!--\s*BACKLOG\.MD\b[^>]*\bSTART\s*-->[\s\S]*?(?:<!--\s*BACKLOG\.MD\b[^>]*\bEND\s*-->|$)/gi;

/** Backlog's guidelines blocks in an instruction file, in order. */
function guidelinesBlocks(text: string): string[] {
  return text.match(GUIDELINES_BLOCK) ?? [];
}

/**
 * Whether `backlog init` wrote into an instruction file: the working copy has
 * a Backlog guidelines block the committed copy (null when untracked) lacks.
 */
export function gainedGuidelines(committedText: string | null, workingText: string): boolean {
  const after = guidelinesBlocks(workingText);
  if (after.length === 0) return false;
  const before = committedText === null ? [] : guidelinesBlocks(committedText);
  return after.join("\n") !== before.join("\n");
}

/** Refusals kept for the board (persisted in the plugin's state). */
export interface TrackerProtection {
  /** When the plugin last refused and restored something. */
  at: string;
  /** What it restored, each a short description. */
  restored: string[];
}

/** Adds a new refusal to the kept one: the latest time, each description once. */
export function mergeProtection(kept: TrackerProtection | null, restored: readonly string[], at: string): TrackerProtection {
  return { at, restored: [...new Set([...(kept?.restored ?? []), ...restored])] };
}

/** The board alert for a kept refusal; null once it is older than a day. */
export function protectionAlert(protection: TrackerProtection | null, now: number): BoardAlert | null {
  if (protection === null || protection.restored.length === 0) return null;
  const at = Date.parse(protection.at);
  if (!Number.isFinite(at) || now - at >= PROTECTION_ALERT_MS) return null;
  return {
    id: PROTECTION_ALERT_ID,
    text: `Taro refused to commit tracker changes that look like a stray \`backlog init\` and restored them: ${protection.restored.join("; ")}. Tickets are unaffected. An agent likely ran Backlog with BACKLOG_CWD still pointing at the tracker.`,
  };
}
