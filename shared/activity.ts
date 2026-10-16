/**
 * What a running agent is doing now, in a few words for its card (TR-080): its latest tool call
 * ("running tests", "editing card-now.ts"), read from the tail of its timeline. Pure.
 */
import { z } from "zod";

import { commandsRun, type CommandRun } from "./shell-command";

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
  return purpose !== undefined ? purpose[1] : commandActivity(command);
}

// Commands that only set the stage (TR-160): the card names the next one, which does the work.
// When there is none, a step that makes something (a folder, a pause) says more than an `echo`.
const QUIET_SET_UP = new Set(["cd", "pushd", "popd", "export", "local", "declare", "readonly", "unset", "set", "shopt", "trap", "source", ".", "echo", "printf", "true", "false", ":", "date", "mktemp", "test", "[", "[[", "read", "shift", "wait", "break", "continue", "return", "exit"]);
const MINOR_SET_UP = new Set(["mkdir", "touch", "chmod", "tee", "sleep"]);
/** A wait this long or longer is what the agent is doing, not a pause between steps. */
const LONG_SLEEP_SECONDS = 10;

// Words for a command no purpose above matched: by kind, never by the script's file name.
const COMMAND_PURPOSES: readonly [RegExp, string][] = [
  [/^taro ticket (view|list|show)\b/, "reading the ticket"],
  [/^paseo (agent|run|send|archive|wait|stop|ls|inspect)\b/, "managing agents"],
  [/^paseo logs\b/, "reading an agent's log"],
  ...SHELL_PURPOSES,
  [/^paseo\b/, "calling paseo"],
  [/^(rm|rmdir|unlink)\b/, "removing files"],
  [/^(cp|rsync|install)\b/, "copying files"],
  [/^mv\b/, "moving files"],
  [/^mkdir\b/, "making a folder"],
  [/^sleep\b/, "waiting"],
  [/^(wc|awk|cut|tail|stat|readlink|realpath|jq|file|du|diff|sort|uniq|tr|xxd|od|tree)\b/, "reading files"],
  [/^(which|type|whereis)\b/, "looking up a program"],
  [/^(curl|wget)\b/, "calling a URL"],
  [/^(ps|pgrep)\b/, "checking processes"],
  [/^(kill|pkill|killall)\b/, "stopping processes"],
  [/^(echo|printf)\b/, "printing a value"],
  [/^cd\b/, "changing folder"],
  [/^(export|set|unset|local|declare)\b/, "setting variables"],
  [/^date\b/, "reading the time"],
];

const SCRIPT_KINDS: readonly [RegExp, string][] = [
  [/^python[0-9.]*$|\.py$/, "running a Python script"],
  [/^(node|tsx|ts-node|deno)$|\.(m|c)?(j|t)s$/, "running a Node script"],
  [/^(bash|sh|zsh|dash)$|\.(ba|z)?sh$/, "running a shell script"],
];

/** Programs whose first argument says what they do: `git worktree`, `gh api`, `docker compose`. */
const SUBCOMMAND_PROGRAMS = new Set(["git", "gh", "npm", "pnpm", "yarn", "bun", "cargo", "go", "docker", "kubectl", "brew", "apt", "apt-get", "pip", "pip3", "systemctl", "taro", "claude"]);

/** A command line no purpose matched as a whole, worded by the first command that does the work. */
function commandActivity(command: string): string {
  const runs = commandsRun(command).filter((run) => !run.program.startsWith("$") && run.program !== "");
  // `until [ -f out.png ]; do sleep 2; done` polls: it is waiting, whatever its condition runs.
  if (runs.some((run) => run.inWaitLoop && run.program === "sleep")) return "waiting";
  const setUp = (run: CommandRun): boolean =>
    (QUIET_SET_UP.has(run.program) && !(/^(echo|printf)$/.test(run.program) && run.writesFile)) ||
    (MINOR_SET_UP.has(run.program) && !(run.program === "sleep" && Number.parseFloat(run.args[0] ?? "0") >= LONG_SLEEP_SECONDS));
  const chosen = runs.find((run) => !setUp(run)) ?? runs.find((run) => MINOR_SET_UP.has(run.program)) ?? runs[0];
  return chosen === undefined ? "running a command" : runActivity(chosen);
}

function runActivity(run: CommandRun): string {
  const program = fileName(run.program);
  // `npx vitest`, `npx tsx script.ts`: the package run is the program.
  if ((program === "npx" || program === "bunx") && run.args.length > 0) {
    const index = run.args.findIndex((arg) => !arg.startsWith("-"));
    if (index !== -1) return runActivity({ ...run, program: run.args[index] ?? "", args: run.args.slice(index + 1) });
  }
  if ((program === "cat" && run.args.every((arg) => arg.startsWith("-"))) || program === "echo" || program === "printf") {
    if (run.writesFile) return "writing a file";
  }
  if (run.args.length === 1 && /^(--version|-v|-V)$/.test(run.args[0] ?? "")) return `checking ${program.slice(0, 24)}'s version`;
  const line = [program, ...run.args].join(" ");
  const purpose = COMMAND_PURPOSES.find(([pattern]) => pattern.test(line));
  if (purpose !== undefined) return purpose[1];
  const script = SCRIPT_KINDS.find(([pattern]) => pattern.test(program));
  if (script !== undefined) return script[1];
  const runScript = /^(npm|pnpm|yarn|bun) run$/.test(`${program} ${run.args[0] ?? ""}`) ? run.args[1] : undefined;
  if (runScript !== undefined && /^[\w:.-]+$/.test(runScript)) return `running the ${runScript.slice(0, 24)} script`;
  // `git -C dir worktree add`: git's options before its subcommand take a value.
  const optionsTaken = program === "git" ? (/^((-[Cc]) \S+ )*/.exec(`${run.args.join(" ")} `)?.[0].split(" ").length ?? 1) - 1 : 0;
  const subcommand = run.args[optionsTaken] ?? "";
  return SUBCOMMAND_PROGRAMS.has(program) && /^[a-z][a-z-]*$/.test(subcommand) ? `running ${program} ${subcommand.slice(0, 24)}` : `running ${program.slice(0, 24)}`;
}

function fileName(path: string): string {
  return path.split("/").filter((part) => part !== "").pop() ?? "";
}
