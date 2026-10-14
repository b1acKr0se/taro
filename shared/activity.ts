/**
 * What a running agent is doing now, in a few words for its card (TR-080): its latest tool call
 * ("running tests", "editing card-now.ts"), read from the tail of its timeline. Pure.
 */
import { z } from "zod";

export const ActivitySchema = z.object({
  text: z.string(),
  /** When the tool call was recorded. */
  at: z.string(),
});
export type Activity = z.infer<typeof ActivitySchema>;

/** The fields of a timeline tool call this reads; the rest of Paseo's item is ignored. */
export interface ToolCallLike {
  type: string;
  name?: string;
  detail?: { type: string; command?: string; filePath?: string; toolName?: string; description?: string; label?: string };
}

/** The latest tool call in a timeline page, as an activity, or null when the page holds none. */
export function latestActivity(entries: readonly { item: ToolCallLike; timestamp: string }[]): Activity | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry === undefined || entry.item.type !== "tool_call") continue;
    return { text: toolActivity(entry.item), at: entry.timestamp };
  }
  return null;
}

/** One tool call in a few lower-case words. */
export function toolActivity(item: ToolCallLike): string {
  const detail = item.detail;
  const name = item.name ?? "";
  switch (detail?.type) {
    case "shell":
      return shellActivity(detail.command ?? "");
    case "read":
      return `reading ${fileName(detail.filePath ?? "")}`.trim();
    case "edit":
    case "write":
      return `editing ${fileName(detail.filePath ?? "")}`.trim();
    case "search":
      return detail.toolName === "web_search" ? "searching the web" : "searching the code";
    case "fetch":
      return "reading a web page";
    case "sub_agent":
      return "running a subagent";
    case "plan":
      return "planning";
    default:
      // Claude's notice that a background command finished arrives as a tool call.
      if (/task.?notification/i.test(name)) return "reading a background task's result";
      if (/screenshot/i.test(name)) return "taking screenshots";
      if (/^mcp__[^_]+__browser_/.test(name)) return "using the browser";
      return name === "" ? "working" : `using ${name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ")}`;
  }
}

/** `git <subcommand>`, allowing `-C <dir>` and `-c <setting>` before it. */
function git(subcommand: string): RegExp {
  return new RegExp(`\\bgit(\\s+-[Cc]\\s+\\S+)*\\s+${subcommand}\\b`);
}

// First match wins: the most specific purpose first, then the program run.
const SHELL_PURPOSES: readonly [RegExp, string][] = [
  [/\b(shot|phone|keyboard)\.cjs\b|playwright|screenshot/, "taking screenshots"],
  [/\bnpm (run )?typecheck\b|\btsc\b/, "type-checking"],
  [/\b(vitest|jest|pytest)\b|\b(npm|pnpm|yarn|bun) (run )?test\b|\bnpm t\b|\b(go|cargo) test\b/, "running tests"],
  [/\b(eslint|biome)\b|\b(npm|pnpm|yarn) (run )?lint\b/, "linting"],
  [/\b(npm|pnpm|yarn|bun) (install|ci|i)\b/, "installing dependencies"],
  [/\b(npm|pnpm|yarn|bun) (run )?build\b/, "building"],
  [git("(commit|cherry-pick)"), "committing"],
  [git("rebase"), "rebasing"],
  [git("merge"), "merging"],
  [git("push"), "pushing"],
  [git("(diff|log|show|status)"), "reading the changes"],
  [/\bgh pr\b/, "working on the pull request"],
  [/\btaro ticket\b/, "updating the ticket"],
  [/\bpaseo daemon\b|\bpaseo plugin\b/, "running a test daemon"],
  [/\bpaseo (run|send|archive|wait)\b/, "managing agents"],
  [/\b(grep|rg|find)\b/, "searching the code"],
  [/^(cat|sed|head|less|ls)\b/, "reading files"],
];

function shellActivity(command: string): string {
  // `cd dir && …` and `FOO=1 …` say nothing about the purpose.
  const core = command.trim().replace(/^(cd\s+\S+\s*(&&|;)\s*)+/, "").replace(/^(\w+=\S*\s+)+/, "");
  const purpose = SHELL_PURPOSES.find(([pattern]) => pattern.test(core));
  if (purpose !== undefined) return purpose[1];
  const program = fileName(core.split(/\s+/)[0] ?? "");
  return program === "" ? "running a command" : `running ${program.slice(0, 24)}`;
}

function fileName(path: string): string {
  return path.split("/").filter((part) => part !== "").pop() ?? "";
}
