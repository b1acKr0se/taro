/**
 * A tool call in the user's words (TR-144): what the agent did, not the command it typed. The chat
 * names a file by its name, never its path, and a shell command by what it does; the raw call stays
 * one tap away in Paseo's own agent tab.
 */
export type ToolCategory = "read" | "search" | "edit" | "run" | "web" | "agent" | "other";

export interface ToolAction {
  text: string;
  category: ToolCategory;
}

/** The parts of Paseo's tool-call detail this file reads; a detail it does not know is "other". */
export type ToolDetail =
  | { type: "shell"; command: string }
  | { type: "read" | "edit" | "write"; filePath: string }
  | { type: "search"; query: string; toolName?: string }
  | { type: "fetch"; url: string }
  | { type: "sub_agent"; description?: string; subAgentType?: string }
  | { type: "plain_text"; label?: string; text?: string }
  | { type: "plan" }
  | { type: string };

/** `/home/user/project/src/a.ts` → `a.ts`. */
export function fileName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
  return name === "" ? path : name;
}

function quoted(text: string, max = 40): string {
  const single = text.replace(/\s+/g, " ").trim();
  return `“${single.length <= max ? single : `${single.slice(0, max - 1)}…`}”`;
}

function host(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  return match?.[1] ?? url;
}

/** Programs whose second word says what they did (`git log`, `npm test`). */
const WITH_SUBCOMMAND = new Set(["git", "npm", "pnpm", "yarn", "npx", "gh", "cargo", "go", "docker", "paseo", "taro", "make"]);

const SHELL_WORDS: Record<string, ToolAction> = {
  ls: { text: "Listed files", category: "search" },
  find: { text: "Looked for files", category: "search" },
  tree: { text: "Listed files", category: "search" },
  grep: { text: "Searched the code", category: "search" },
  rg: { text: "Searched the code", category: "search" },
  cat: { text: "Read a file", category: "read" },
  head: { text: "Read a file", category: "read" },
  tail: { text: "Read a file", category: "read" },
  sed: { text: "Read a file", category: "read" },
  wc: { text: "Counted lines", category: "read" },
  "git log": { text: "Looked at the history", category: "read" },
  "git show": { text: "Looked at a commit", category: "read" },
  "git diff": { text: "Looked at the changes", category: "read" },
  "git status": { text: "Checked the changes", category: "read" },
  "git commit": { text: "Committed", category: "edit" },
  "npm test": { text: "Ran the tests", category: "run" },
  "npm install": { text: "Installed packages", category: "run" },
};

/** Words that only run the next one: `sudo npm test` is the tests. */
const PREFIXES = new Set(["sudo", "env", "nohup", "time", "exec", "command"]);

/** The words a command line starts with, past `cd …&&`, `VAR=…`, `sudo` and a path to the program. */
export function shellWords(command: string): string[] {
  const steps = command.split(/&&|\|\||;|\n/).map((step) => step.trim()).filter((step) => step !== "" && !step.startsWith("#"));
  const step = steps.find((each) => !/^(cd|export|set|source)\b/.test(each)) ?? steps[0] ?? "";
  const words = step.split(/\s+/).filter((word) => word !== "" && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  while (words.length > 1 && PREFIXES.has(words[0] ?? "")) words.shift();
  return words.length === 0 ? [] : [fileName(words[0] ?? ""), ...words.slice(1)];
}

const READS_A_FILE = new Set(["cat", "head", "tail", "sed", "less"]);

const RUNS_SCRIPTS = new Set(["npm", "pnpm", "yarn"]);

function shellAction(command: string): ToolAction {
  const words = shellWords(command);
  const [program = "", next = "", third = ""] = words;
  if (program === "") return { text: "Ran a command", category: "run" };
  const last = words[words.length - 1] ?? "";
  if (READS_A_FILE.has(program) && words.length > 1 && /^[\w./~-]+\.\w+$/.test(last)) return { text: `Read ${fileName(last)}`, category: "read" };
  if (RUNS_SCRIPTS.has(program) && next === "run" && /^[\w:.-]+$/.test(third)) return { text: `Ran the ${third} script`, category: "run" };
  const named = WITH_SUBCOMMAND.has(program) && /^[a-z][a-z-]*$/.test(next) ? `${program} ${next}` : program;
  return SHELL_WORDS[named] ?? SHELL_WORDS[program] ?? { text: `Ran ${named}`, category: "run" };
}

export function toolAction(detail: ToolDetail, name: string): ToolAction {
  switch (detail.type) {
    case "shell":
      return shellAction((detail as { command: string }).command);
    case "read":
      return { text: `Read ${fileName((detail as { filePath: string }).filePath)}`, category: "read" };
    case "edit":
      return { text: `Edited ${fileName((detail as { filePath: string }).filePath)}`, category: "edit" };
    case "write":
      return { text: `Wrote ${fileName((detail as { filePath: string }).filePath)}`, category: "edit" };
    case "search": {
      const search = detail as { query: string; toolName?: string };
      if (search.toolName === "web_search") return { text: `Searched the web for ${quoted(search.query)}`, category: "web" };
      if (search.toolName === "glob") return { text: "Looked for files", category: "search" };
      return { text: `Searched for ${quoted(search.query)}`, category: "search" };
    }
    case "fetch":
      return { text: `Opened ${host((detail as { url: string }).url)}`, category: "web" };
    case "sub_agent": {
      const agent = detail as { description?: string; subAgentType?: string };
      const what = agent.description ?? agent.subAgentType;
      return { text: what === undefined || what === "" ? "Started a subagent" : `Started a subagent: ${what}`, category: "agent" };
    }
    case "plain_text": {
      const plain = detail as { label?: string; text?: string };
      return { text: plain.label ?? plain.text ?? name, category: "other" };
    }
    case "plan":
      return { text: "Wrote a plan", category: "other" };
    default:
      return { text: name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " "), category: "other" };
  }
}

const TALLY: Record<ToolCategory, (count: number) => string> = {
  read: (count) => `read ${count === 1 ? "a file" : `${count} files`}`,
  search: (count) => `searched ${count === 1 ? "once" : count === 2 ? "twice" : `${count} times`}`,
  edit: (count) => `changed ${count === 1 ? "a file" : `${count} files`}`,
  run: (count) => `ran ${count === 1 ? "a command" : `${count} commands`}`,
  web: (count) => `looked online ${count === 1 ? "once" : count === 2 ? "twice" : `${count} times`}`,
  agent: (count) => `started ${count === 1 ? "a subagent" : `${count} subagents`}`,
  other: (count) => `${count === 1 ? "one other step" : `${count} other steps`}`,
};

/** "Read 2 files, searched twice, ran a command": each kind once, in the order the agent first did it. */
export function toolTally(categories: readonly ToolCategory[]): string {
  const counts = new Map<ToolCategory, number>();
  categories.forEach((category) => counts.set(category, (counts.get(category) ?? 0) + 1));
  const text = [...counts].map(([category, count]) => TALLY[category](count)).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
