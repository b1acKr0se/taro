/**
 * The plugin's own files at runtime: `skill/` (what agents read) and
 * `templates/` (what the plugin writes or says). Paseo compiles the server half
 * into one script run from memory, so `import.meta.url` is empty there and the
 * package is found through `paseo plugin ls`; in tests, the folder beside the
 * code is used. Approach from FirstMate's `server/templates.ts` (MIT).
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pluginDirectory } from "./cli";
import { PLUGIN_ID } from "./data-dir";

export const TEMPLATES = {
  managerAgents: "manager-AGENTS.md",
  standingOrders: "standing-orders.md",
  suggestions: "suggestions.md",
  managerOpening: "messages/manager-opening.md",
  managerRestart: "messages/manager-restart.md",
  managerResumed: "messages/manager-resumed.md",
  catchUp: "messages/catch-up.md",
  nudge: "messages/nudge.md",
  decisionCorrection: "messages/decision-correction.md",
  decisionHeld: "messages/decision-held.md",
  subagentReport: "messages/subagent-report.md",
  handoffRequest: "messages/handoff-request.md",
  compactInstructions: "messages/compact-instructions.md",
  reload: "messages/reload.md",
  managerHandoffRequest: "messages/manager-handoff-request.md",
  managerReload: "messages/manager-reload.md",
  managerCompactRequest: "messages/manager-compact-request.md",
  managerCompactInstructions: "messages/manager-compact-instructions.md",
  relaunchOwner: "messages/relaunch-owner.md",
  carriedQuestions: "messages/carried-questions.md",
  pause: "messages/pause.md",
  accept: "messages/accept.md",
  acceptFreshOwner: "messages/accept-fresh-owner.md",
  requestChanges: "messages/request-changes.md",
  specChange: "messages/spec-change.md",
  dependencyCleared: "messages/dependency-cleared.md",
  ticketQueued: "messages/ticket-queued.md",
  queueIdle: "messages/queue-idle.md",
  recount: "messages/recount.md",
  managerQueueRestart: "messages/manager-queue-restart.md",
  answer: "messages/answer.md",
  planChanges: "messages/plan-changes.md",
  crashRecovery: "messages/crash-recovery.md",
  subagentCrashed: "messages/subagent-crashed.md",
  headroomRecovered: "messages/headroom-recovered.md",
  evidenceMissing: "messages/evidence-missing.md",
  permissionDenied: "messages/permission-denied.md",
  permissionRules: "permission-rules.md",
} as const;

export type TemplatePath = (typeof TEMPLATES)[keyof typeof TEMPLATES];

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function locatePackage(): Promise<string> {
  const url: unknown = import.meta.url;
  if (typeof url === "string" && url.startsWith("file:")) {
    const beside = join(dirname(fileURLToPath(url)), "..");
    if (await isDirectory(join(beside, "skill"))) return beside;
  }
  const directory = await pluginDirectory(PLUGIN_ID);
  if (!(await isDirectory(join(directory, "skill")))) {
    throw new Error(`Taro's skill files are not in ${directory}. Reinstall the plugin.`);
  }
  return directory;
}

let located: Promise<string> | null = null;
const cache = new Map<string, Promise<string>>();

/** The installed package's directory; a failed lookup is retried on the next call. */
export function packageDirectory(): Promise<string> {
  located ??= locatePackage().catch((error: unknown) => {
    located = null;
    throw error;
  });
  return located;
}

export async function skillDirectory(): Promise<string> {
  return join(await packageDirectory(), "skill");
}

export function readTemplate(path: TemplatePath): Promise<string> {
  let text = cache.get(path);
  if (text === undefined) {
    text = packageDirectory().then((directory) => readFile(join(directory, "templates", path), "utf8"));
    cache.set(path, text);
    text.catch(() => cache.delete(path));
  }
  return text;
}

/** Text without its notes (HTML comments) and surrounding whitespace. */
export function withoutNotes(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** `{{name}}` filled in one pass; a filled value is never read for placeholders. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (whole, name: string) => values[name] ?? whole);
}

/** A template from `templates/messages/`, notes left out, placeholders filled. */
export async function message(path: TemplatePath, values: Readonly<Record<string, string>> = {}): Promise<string> {
  return fill(withoutNotes(await readTemplate(path)), values);
}
