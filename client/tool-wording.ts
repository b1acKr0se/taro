/**
 * A tool call as Paseo's own chat shows it (TR-150): a run of calls folds to Paseo's counts ("Ran 2
 * commands, read 1 file, and used 1 other tool") and lists each call as its tool's icon, label and
 * detail ("Shell  npm test", "Read  client/notes.ts").
 *
 * Ported from Paseo (v0.11.2, Apache-2.0): `buildToolCallDisplayModel` and `humanizeToolName` from
 * `packages/protocol/src/tool-call-display.ts`, `isPaseoToolName` and `getPaseoToolLeafName` from
 * `tool-name-normalization.ts`, `stripCwdPrefix` from `path-utils.ts`, and the app's overview tool-call
 * group (`buildOverviewGroup`, its summary text and `resolveToolCallIconName`). Changed: the parts
 * Taro reads only, English only, and Lucide icon names in place of Paseo's icon ids (its Paseo logo,
 * which a plugin cannot draw, is a wrench).
 */

/** The parts of Paseo's tool-call detail this file reads; a detail it does not know is "unknown". */
export type ToolDetail =
  | { type: "shell"; command: string }
  | { type: "read" | "edit" | "write"; filePath: string }
  | { type: "search"; query: string; toolName?: string }
  | { type: "fetch"; url: string }
  | { type: "worktree_setup"; branchName?: string }
  | { type: "sub_agent"; description?: string; subAgentType?: string }
  | { type: "plain_text"; label?: string; text?: string; icon?: string }
  | { type: "plan" }
  | { type: string };

export interface ToolDisplay {
  /** "Shell", "Read", a subagent's type, or the tool's name made readable. */
  label: string;
  /** The command, path, query or URL; absent when the call has none. */
  summary?: string;
  /** A Lucide icon name for the plugin's `Icon`. */
  icon: string;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

function isSpeakToolName(name: string): boolean {
  const tokens = normalizedName(name).match(/[a-z0-9]+/g) ?? [];
  return tokens[tokens.length - 1] === "speak";
}

/** The tool's name past Paseo's own MCP prefix (`mcp__paseo__create_agent`, `paseo.create_agent`), or null. */
function paseoLeafName(name: string): string | null {
  const normalized = normalizedName(name);
  if (normalized.includes("__")) {
    const segments = normalized.split("__").filter((segment) => segment.length > 0);
    const [first, second] = segments;
    return segments.length >= 3 && first === "mcp" && second !== undefined && (second === "paseo" || second.startsWith("paseo_")) ? segments.slice(2).join("__") : null;
  }
  if (normalized.includes(".")) {
    const [first = ""] = normalized.split(".");
    return first === "paseo" || first.startsWith("paseo_") ? normalized.split(".").slice(1).join(".") : null;
  }
  return null;
}

export function isPaseoToolName(name: string): boolean {
  return !isSpeakToolName(name) && paseoLeafName(name) !== null;
}

/** `get_agent_activity` → "Get agent activity"; a namespaced name stays as it is. */
export function humanizeToolName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return name;
  const leaf = paseoLeafName(trimmed);
  if (leaf !== null && leaf !== "") return humanizeToolName(leaf);
  if (/[:./]/.test(trimmed) || trimmed.includes("__")) return trimmed;
  return trimmed
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter((segment) => segment.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

/** `/home/user/project/src/a.ts` in `/home/user/project` → `src/a.ts`; a path elsewhere stays whole. */
export function stripCwdPrefix(filePath: string, cwd: string | null | undefined): string {
  if (cwd === null || cwd === undefined || cwd === "" || filePath === "") return filePath;
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (normalizedPath.startsWith(`${normalizedCwd}/`)) return normalizedPath.slice(normalizedCwd.length + 1);
  return normalizedPath === normalizedCwd ? "." : filePath;
}

/** Paseo's icon ids, as Lucide names. */
const ICONS: Record<string, string> = {
  wrench: "Wrench",
  square_terminal: "SquareTerminal",
  eye: "Eye",
  pencil: "Pencil",
  search: "Search",
  bot: "Bot",
  sparkles: "Sparkles",
  brain: "Brain",
  mic_vocal: "MicVocal",
  paseo: "Wrench",
};

const ICON_BY_DETAIL: Record<string, string> = {
  shell: "square_terminal",
  read: "eye",
  edit: "pencil",
  write: "pencil",
  search: "search",
  fetch: "search",
  worktree_setup: "square_terminal",
  sub_agent: "bot",
  plain_text: "wrench",
  plan: "brain",
  unknown: "wrench",
};

function iconId(name: string, detail: ToolDetail): string {
  const lower = normalizedName(name);
  const plainIcon = detail.type === "plain_text" ? text((detail as { icon?: string }).icon) : undefined;
  if (plainIcon !== undefined) return plainIcon;
  if (lower === "thinking" && detail.type === "unknown") return "brain";
  if (lower === "speak") return "mic_vocal";
  if (isPaseoToolName(lower)) return "paseo";
  if (lower === "task") return "bot";
  return ICON_BY_DETAIL[detail.type] ?? "wrench";
}

function detailDisplay(detail: ToolDetail, cwd: string | null | undefined): { label?: string; summary?: string | undefined } {
  switch (detail.type) {
    case "shell":
      return { label: "Shell", summary: (detail as { command: string }).command };
    case "read":
      return { label: "Read", summary: stripCwdPrefix((detail as { filePath: string }).filePath, cwd) };
    case "edit":
      return { label: "Edit", summary: stripCwdPrefix((detail as { filePath: string }).filePath, cwd) };
    case "write":
      return { label: "Write", summary: stripCwdPrefix((detail as { filePath: string }).filePath, cwd) };
    case "search":
      return { label: "Search", summary: (detail as { query: string }).query };
    case "fetch":
      return { label: "Fetch", summary: (detail as { url: string }).url };
    case "worktree_setup":
      return { label: "Worktree setup", summary: (detail as { branchName?: string }).branchName };
    case "sub_agent": {
      const agent = detail as { description?: string; subAgentType?: string };
      return { label: text(agent.subAgentType) ?? "Task", summary: text(agent.description) };
    }
    case "plain_text":
      return { summary: (detail as { label?: string }).label };
    case "plan":
      return { label: "Plan" };
    default:
      return {};
  }
}

/** One call's line: Paseo's label, its detail and icon. `cwd`, the agent's folder, shortens paths inside it. */
export function toolDisplay(detail: ToolDetail, name: string, cwd?: string | null, metadata?: unknown): ToolDisplay {
  const lower = normalizedName(name);
  let override: { label?: string; summary?: string | undefined } = {};
  if (detail.type === "unknown" && lower === "task") {
    const activity = typeof metadata === "object" && metadata !== null ? text((metadata as { subAgentActivity?: unknown }).subAgentActivity) : undefined;
    override = { label: "Task", summary: activity };
  } else if (detail.type === "unknown" && lower === "thinking") override = { label: "Thinking" };
  else if (lower === "terminal") override = { label: "Terminal", summary: detail.type === "plain_text" ? text((detail as { label?: string }).label) : undefined };
  const canonical = detailDisplay(detail, cwd);
  const summary = override.summary ?? canonical.summary;
  return {
    label: override.label ?? canonical.label ?? humanizeToolName(name),
    ...(summary !== undefined && summary !== "" ? { summary } : {}),
    icon: ICONS[iconId(name, detail)] ?? "Wrench",
  };
}

/** What a call adds to its run's counts: the kind, and the file for kinds counted once per file. */
export type ToolTally = { kind: "edited" | "read"; filePath: string } | { kind: "command" | "search" | "other" | "paseo" };

export function toolTally(detail: ToolDetail, name: string): ToolTally {
  const lower = normalizedName(name);
  if (isPaseoToolName(name) || lower.startsWith("paseo_")) return { kind: "paseo" };
  if (detail.type === "edit" || detail.type === "write") return { kind: "edited", filePath: (detail as { filePath: string }).filePath };
  if (detail.type === "shell") return { kind: "command" };
  if (detail.type === "read") return { kind: "read", filePath: (detail as { filePath: string }).filePath };
  if (detail.type === "search" || /(?:^|[_.:/])(?:web_search|llm_context)$/.test(lower)) return { kind: "search" };
  return { kind: "other" };
}

const PHRASES: [ToolTally["kind"], string, string][] = [
  ["edited", "edited {n} file", "edited {n} files"],
  ["command", "ran {n} command", "ran {n} commands"],
  ["read", "read {n} file", "read {n} files"],
  ["search", "searched {n} time", "searched {n} times"],
  ["other", "used {n} other tool", "used {n} other tools"],
  ["paseo", "called Paseo {n} time", "called Paseo {n} times"],
];

/** "Ran 2 commands, read 1 file, and used 1 other tool": each kind in Paseo's order, a file counted once. */
export function toolRunTitle(tallies: readonly ToolTally[]): string {
  const files = { edited: new Set<string>(), read: new Set<string>() };
  const counts: Record<ToolTally["kind"], number> = { edited: 0, command: 0, read: 0, search: 0, other: 0, paseo: 0 };
  tallies.forEach((tally) => {
    if ("filePath" in tally) files[tally.kind].add(tally.filePath);
    else counts[tally.kind] += 1;
  });
  counts.edited = files.edited.size;
  counts.read = files.read.size;
  const parts = PHRASES.filter(([kind]) => counts[kind] > 0).map(([kind, one, many]) => (counts[kind] === 1 ? one : many).replace("{n}", String(counts[kind])));
  const last = parts[parts.length - 1] ?? "";
  const joined = parts.length <= 1 ? last : parts.length === 2 ? `${parts[0]} and ${last}` : `${parts.slice(0, -1).join(", ")}, and ${last}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** Paseo shows a plan and a spoken reply on their own, never inside a run. */
export function joinsRuns(detail: ToolDetail, name: string): boolean {
  return detail.type !== "plan" && normalizedName(name) !== "speak";
}
