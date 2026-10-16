/**
 * The starting context of Taro's owners and subagents on Claude (TR-139): the tools, MCP server and
 * skills no Taro role uses come off at launch, and a later turn that reaches for one of them, or a
 * start that grew back, is flagged on the agent's ticket. What each role uses, from 296 real
 * sessions and the role files, is the inventory in TR-139's description; change these lists only
 * with that kind of evidence.
 */

/**
 * Claude Code's `disallowedTools`: each entry leaves the tool out of the model's context. `mcp__paseo`
 * is Paseo's whole MCP server (every Paseo MCP call a role made has a `paseo` CLI twin, which
 * `skill/reference/paseo.md` prescribes). Agent, SendMessage and ListAgents run Claude's built-in
 * subagents, which SKILL.md rule 4 forbids; roles ask the user only with decision blocks; Paseo owns
 * worktrees and the plugin owns nudges and notifications.
 */
export const TRIMMED_TOOLS: readonly string[] = [
  "mcp__paseo",
  "Agent",
  "SendMessage",
  "ListAgents",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "EnterWorktree",
  "ExitWorktree",
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "DesignSync",
  "PushNotification",
];

/**
 * Skills turned off (`skillOverrides: "off"`) in the working directory's `.claude/settings.local.json`:
 * Paseo's own, which drive agents through the MCP tools removed above, and Claude's `loop`, which
 * needs the removed Cron tools. The user's own, project and plugin skills stay: owners use them.
 */
export const HIDDEN_SKILLS: readonly string[] = ["paseo", "paseo-advisor", "paseo-committee", "paseo-handoff", "paseo-help", "loop"];

/** A trimmed agent whose first request is larger than this gets a CONTEXT note: something grew back. */
export const STARTING_CONTEXT_LIMIT = 30_000;

/** Claude's provider id, alone or with a model (`claude/claude-sonnet-5-5`). */
export function isClaudeProvider(provider: string): boolean {
  return provider === "claude" || provider.startsWith("claude/");
}

/**
 * Whether an agent being created is a Taro owner or subagent on Claude: it carries the Taro
 * environment (owners get it from the manager's or the plugin's launch, subagents from their owner's
 * `paseo run --env`) and does not work in a manager's home. The user's own agents carry no Taro
 * environment; the manager is left as it is.
 */
export function isTrimmedLaunch(launch: { provider: string; env?: Record<string, string> | undefined; inManagerHome: boolean }): boolean {
  const project = launch.env?.TARO_PROJECT;
  return isClaudeProvider(launch.provider) && !launch.inManagerHome && typeof project === "string" && project !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The provider options with every trimmed tool added to `disallowedTools`, keeping whatever was there. */
export function withTrimmedTools(providerOptions: Record<string, unknown> | undefined): Record<string, unknown> {
  const options = isRecord(providerOptions) ? providerOptions : {};
  const current = Array.isArray(options.disallowedTools) ? options.disallowedTools.filter((tool): tool is string => typeof tool === "string") : [];
  return { ...options, disallowedTools: [...new Set([...current, ...TRIMMED_TOOLS])] };
}

/** Whether a tool name is one of the trimmed tools (a Paseo MCP tool by its server). */
export function isTrimmedTool(name: string): boolean {
  if (name === "mcp__paseo" || name.startsWith("mcp__paseo__")) return true;
  return TRIMMED_TOOLS.includes(name);
}

/**
 * What Claude Code answers a call to a tool or skill the agent does not have, inside the
 * `<tool_use_error>` it wraps its own refusals in. A failed command's error is its output, which may
 * print these words (a failing test of this file does), so unwrapped text is never a refusal.
 */
const REFUSAL = /^\s*<tool_use_error>([\s\S]*?)<\/tool_use_error>/;
const MISSING_ERROR = /no such tool|unknown skill|skill .* (is )?(not found|disabled|not available)|disabled for model invocation|tool .* (is )?not available/i;

export interface ToolMiss {
  tool: string;
  reason: string;
}

/** An error as text: Claude's tool_result content or a message when there is one, else its JSON. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (isRecord(value)) {
    for (const key of ["content", "message"]) {
      const text = value[key];
      if (typeof text === "string") return text;
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** The skill a Skill call names: Paseo shows it as a plain-text detail labelled with the skill. */
function skillNamed(detail: unknown): string | null {
  if (!isRecord(detail)) return null;
  if (detail.type === "plain_text" && typeof detail.label === "string") return detail.label;
  for (const holder of [detail.input, detail]) {
    if (isRecord(holder) && typeof holder.skill === "string") return holder.skill;
  }
  return null;
}

function oneLine(text: string, limit = 120): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/**
 * Every call in a turn that reached for something a trimmed agent lacks: a trimmed tool, a hidden
 * skill, or a call Claude Code refused because the tool or skill is not there. Ordinary failures
 * (a command exiting 1, a file not found) are not misses. One entry per tool and reason.
 */
export function toolMisses(items: readonly unknown[]): ToolMiss[] {
  const misses = new Map<string, ToolMiss>();
  const add = (miss: ToolMiss) => misses.set(`${miss.tool}\n${miss.reason}`, miss);
  for (const item of items) {
    if (!isRecord(item) || item.type !== "tool_call" || typeof item.name !== "string") continue;
    const name = item.name;
    if (isTrimmedTool(name)) {
      add({ tool: name, reason: "a removed tool" });
      continue;
    }
    if (name === "Skill") {
      const skill = skillNamed(item.detail);
      if (skill !== null && HIDDEN_SKILLS.includes(skill)) {
        add({ tool: `Skill(${skill})`, reason: "a hidden skill" });
        continue;
      }
    }
    if (item.status !== "failed") continue;
    const refusal = REFUSAL.exec(textOf(item.error))?.[1];
    if (refusal !== undefined && MISSING_ERROR.test(refusal)) add({ tool: name, reason: `refused: ${oneLine(refusal)}` });
  }
  return [...misses.values()];
}

/**
 * The TOOL-MISS record for a ticket's notes; what was missed comes first, as a collapsed row shows
 * only its start. Tool names are code, or the Ticket tab would read `mcp__paseo__…` as bold.
 */
export function toolMissRecord(at: string, agent: { id: string; role: string }, misses: readonly ToolMiss[]): string {
  const list = misses.map((miss) => `\`${miss.tool}\` (${miss.reason})`).join("; ");
  return `TOOL-MISS ${at} — ${list}: ${agent.role} ${agent.id} reached for what Taro removed at launch (TR-139). If the role needs it, take it off the lists in shared/agent-trim.ts.`;
}

/** The CONTEXT record for a ticket's notes; the size comes first, as a collapsed row shows only its start. */
export function contextRecord(at: string, agent: { id: string; role: string }, tokens: number): string {
  return `CONTEXT ${at} — ${tokens.toLocaleString("en-US")} tokens at start, over ${STARTING_CONTEXT_LIMIT.toLocaleString("en-US")}: ${agent.role} ${agent.id}, where a trimmed owner or subagent starts under that (TR-139). It was launched without the Taro environment, or new tools, MCP servers, skills or instructions grew its first request.`;
}

/** The first request's whole input (fresh, cache written and cache read) from a transcript line, or null. */
export function firstRequestTokens(line: string): number | null {
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return null;
  try {
    const entry = JSON.parse(line) as { type?: unknown; isSidechain?: unknown; message?: { usage?: Record<string, unknown> } };
    if (entry.type !== "assistant" || entry.isSidechain === true) return null;
    const usage = entry.message?.usage;
    if (!isRecord(usage)) return null;
    const parts = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens].map((part) => (typeof part === "number" && Number.isFinite(part) ? part : 0));
    const total = parts.reduce((sum, part) => sum + part, 0);
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}
