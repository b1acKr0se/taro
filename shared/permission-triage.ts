/**
 * Fixed rules for a bypass-mode agent's shell permission ask (TR-143). In bypass mode the only shell
 * asks are Claude Code's own safety checks, nearly all of them removals. A removal whose every target
 * is a literal path inside a scratch folder or the agent's working directory, in a command that
 * otherwise only reads, is allowed; a removal of something no unattended agent should remove is
 * denied with the rule it broke; everything else is left to the user. No judgment: anything the
 * parser does not fully understand is left to the user. Pure.
 */

export const DENY_RULES = ["root", "home", "working-directory", "system", "top-level", "unguarded-variable"] as const;
export type DenyRule = (typeof DENY_RULES)[number];
export type AllowRule = "scratch-or-worktree";

export type Triage =
  | { verdict: "allow"; rule: AllowRule; paths: string[] }
  | { verdict: "deny"; rule: DenyRule; path: string }
  | { verdict: "ask" };

export interface TriageContext {
  /** The agent's working directory (its worktree), absolute. */
  cwd: string;
  /** The home directory of the user the agent runs as, absolute. */
  home: string;
}

export interface ShellAsk {
  name: string;
  kind: string;
  input?: Record<string, unknown> | null | undefined;
}

const ASK: Triage = { verdict: "ask" };

/** What the rules decide for one permission request. */
export function triagePermission(request: ShellAsk, context: TriageContext): Triage {
  if (request.kind !== "tool" || request.name !== "Bash") return ASK;
  const command = request.input?.command;
  if (typeof command !== "string") return ASK;
  return triageCommand(command, context);
}

/** Commands that only read or print, run beside a removal without changing the verdict. */
const READ_ONLY = new Set(["ls", "echo", "printf", "true", "false", "test", "[", "pwd", "cat", "stat", "du", "wc", "sleep", "date", "file", "readlink", "realpath", "basename", "dirname", "head", "tail", "grep", "which", "cd"]);
const REMOVALS = new Set(["rm", "rmdir", "unlink"]);
/** System folders: removing one, or anything in one, is never an agent's cleanup. Scratch space inside them is left to the user. */
const SYSTEM = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/libx32", "/opt", "/proc", "/run", "/sbin", "/srv", "/sys", "/usr", "/var"];
const SYSTEM_SCRATCH = ["/var/tmp", "/dev/shm"];

export function triageCommand(command: string, context: TriageContext): Triage {
  const segments = parseCommand(command);
  if (segments === null) return ASK;
  let removals = 0;
  let onlySafe = true;
  const allowed: string[] = [];
  for (const segment of segments) {
    if (segment.writes) onlySafe = false;
    const name = segment.words[0];
    if (name === undefined) continue;
    if (!name.literal) return ASK;
    if (REMOVALS.has(name.text)) {
      removals += 1;
      const targets = removalTargets(segment.words.slice(1));
      if (targets === null) {
        onlySafe = false;
        continue;
      }
      for (const target of targets) {
        const denied = deniedTarget(target, context);
        if (denied !== null) return denied;
        const safe = safeTarget(target, context);
        if (safe === null) onlySafe = false;
        else allowed.push(safe);
      }
    } else if (!READ_ONLY.has(name.text)) {
      onlySafe = false;
    }
  }
  return removals > 0 && onlySafe ? { verdict: "allow", rule: "scratch-or-worktree", paths: allowed } : ASK;
}

/** A shell word after expansion of the variables the command itself assigns a literal value. */
export interface Word {
  /** The word's text; an unknown variable or a glob leaves it not literal. */
  text: string;
  literal: boolean;
  /** Has an unquoted glob or brace (`*`, `?`, `[`, `{`). */
  glob: boolean;
  /** Has a variable the command never assigned and that is not guarded with `:?`. */
  unguarded: boolean;
  /** The text with every unguarded unknown variable empty: what an unset variable makes of it. */
  ifEmpty: string;
}

export interface Segment {
  words: Word[];
  /** Redirects output to a file other than /dev/null. */
  writes: boolean;
}

/**
 * The command's simple commands, split at `;`, `&&`, `||`, `|`, `&` and newlines, with leading
 * assignments applied (bare `NAME=value` or `export NAME=value`) and dropped. Null when it holds
 * anything not followed here: command or process substitution, here-documents, subshells, groups.
 */
export function parseCommand(command: string): Segment[] | null {
  const variables = new Map<string, Word>();
  const segments: Segment[] = [];
  let words: Word[] = [];
  let writes = false;
  let pendingRedirect: "write" | "read" | null = null;
  let word: Word | null = null;
  let quote: "'" | '"' | null = null;

  const start = (): Word => (word ??= { text: "", literal: true, glob: false, unguarded: false, ifEmpty: "" });
  const append = (text: string): void => {
    const current = start();
    current.text += text;
    current.ifEmpty += text;
  };
  const finishWord = (): void => {
    if (word === null) return;
    const finished = word;
    word = null;
    if (pendingRedirect !== null) {
      if (pendingRedirect === "write" && finished.text !== "/dev/null") writes = true;
      pendingRedirect = null;
      return;
    }
    words.push(finished);
  };
  const finishSegment = (): boolean => {
    finishWord();
    if (pendingRedirect !== null) return false;
    const assignments: [string, Word][] = [];
    let rest = words;
    if (rest[0]?.literal === true && rest[0].text === "export") rest = rest.slice(1);
    while (rest[0] !== undefined && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0].text)) {
      const first = rest[0];
      const equals = first.text.indexOf("=");
      assignments.push([first.text.slice(0, equals), { ...first, text: first.text.slice(equals + 1), ifEmpty: first.ifEmpty.slice(equals + 1) }]);
      rest = rest.slice(1);
    }
    // Only a segment of nothing but assignments sets them for what follows; `NAME=x cmd` sets them for cmd alone.
    if (rest.length === 0) {
      for (const [name, value] of assignments) variables.set(name, value);
    }
    if (rest.length > 0 || writes) segments.push({ words: rest, writes });
    words = [];
    writes = false;
    return true;
  };

  let index = 0;
  while (index < command.length) {
    const character = command[index] ?? "";
    const next = command[index + 1] ?? "";
    if (quote === "'") {
      if (character === "'") quote = null;
      else append(character);
      index += 1;
      continue;
    }
    if (character === "`") return null;
    if (character === "\\") {
      if (next === "\n") {
        index += 2;
        continue;
      }
      if (quote === '"' && !'$`"\\'.includes(next)) append(character);
      else if (quote === null && next === "") return null;
      append(next);
      index += 2;
      continue;
    }
    if (character === "$") {
      const expansion = readExpansion(command, index);
      if (expansion === null) return null;
      const current = start();
      const known = expansion.name === null ? undefined : variables.get(expansion.name);
      if (known !== undefined) {
        // Assigned earlier in the command: its value, carrying what it was made of.
        current.text += known.text;
        current.ifEmpty += known.ifEmpty;
        current.literal &&= known.literal;
        current.unguarded ||= known.unguarded;
      } else {
        current.literal = false;
        current.text += "\u0000";
        if (!expansion.guarded) current.unguarded = true;
        else current.ifEmpty += "\u0000";
      }
      index = expansion.end;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else append(character);
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      start();
      quote = character;
      index += 1;
      continue;
    }
    if (character === "#" && word === null) {
      while (index < command.length && command[index] !== "\n") index += 1;
      continue;
    }
    if (character === " " || character === "\t") {
      finishWord();
      index += 1;
      continue;
    }
    if (character === "\n" || character === ";" || character === "|" || character === "&") {
      if (character === "&" && next === ">") {
        finishWord();
        pendingRedirect = "write";
        index += command[index + 2] === ">" ? 3 : 2;
        continue;
      }
      if (!finishSegment()) return null;
      index += (character === "&" || character === "|") && next === character ? 2 : 1;
      continue;
    }
    if (character === "(" || character === ")") return null;
    if ((character === "{" || character === "}") && word === null && /[\s;]|^$/.test(command[index + 1] ?? "")) return null;
    if (character === ">" || character === "<") {
      // A file descriptor right before the operator (`2>`) belongs to it, not to a word.
      // `word` is set inside the helpers above, which narrowing does not follow.
      const before = word as Word | null;
      if (before !== null && before.literal && /^\d+$/.test(before.text)) word = null;
      else finishWord();
      if (character === "<" && (next === "<" || next === "(")) return null;
      if (character === ">" && next === "(") return null;
      let length = 1;
      if (character === ">" && (next === ">" || next === "|")) length = 2;
      if (command[index + length] === "&") {
        // `>&2`, `2>&1`: a descriptor, not a file.
        length += 1;
        while (/\d|-/.test(command[index + length] ?? "")) length += 1;
        index += length;
        continue;
      }
      pendingRedirect = character === ">" ? "write" : "read";
      index += length;
      continue;
    }
    if (character === "~" && word === null) {
      const after = command[index + 1] ?? "";
      if (after === "" || after === "/" || /[\s;&|]/.test(after)) {
        start().text += "\u0001";
        start().ifEmpty += "\u0001";
        index += 1;
        continue;
      }
      return null;
    }
    if ("*?[{}".includes(character)) {
      const current = start();
      current.glob = true;
      current.literal = false;
    }
    append(character);
    index += 1;
  }
  if (quote !== null) return null;
  if (!finishSegment()) return null;
  return segments;
}

interface Expansion {
  name: string | null;
  guarded: boolean;
  end: number;
}

/** `$NAME`, `${NAME}`, `${NAME:?…}`, `$1`, `$?`…; null for `$(…)` and other forms not followed. */
function readExpansion(command: string, index: number): Expansion | null {
  const next = command[index + 1] ?? "";
  if (next === "(") return null;
  if (next === "{") {
    const close = command.indexOf("}", index + 2);
    if (close < 0) return null;
    const body = command.slice(index + 2, close);
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(:?\?.*)?$/.exec(body);
    if (match === null || body.includes("$") || body.includes("`")) return null;
    return { name: match[1] ?? null, guarded: match[2] !== undefined, end: close + 1 };
  }
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(command.slice(index + 1));
  if (name !== null) return { name: name[0], guarded: false, end: index + 1 + name[0].length };
  if (/[0-9?#$!*@-]/.test(next)) return { name: null, guarded: false, end: index + 2 };
  return null;
}

/** The words a removal acts on, or null when an option is not literal. */
function removalTargets(arguments_: Word[]): Word[] | null {
  const targets: Word[] = [];
  let options = true;
  for (const argument of arguments_) {
    if (options && argument.literal && argument.text === "--") {
      options = false;
      continue;
    }
    if (options && argument.text.startsWith("-")) {
      if (!argument.literal) return null;
      continue;
    }
    targets.push(argument);
  }
  return targets;
}

/** The deny the target earns, as written or with its unguarded variables empty; null when none. */
function deniedTarget(target: Word, context: TriageContext): Triage | null {
  const asWritten = dangerousPath(target.text, target.glob, context);
  if (asWritten !== null) return { verdict: "deny", ...asWritten };
  if (!target.unguarded) return null;
  const ifEmpty = dangerousPath(target.ifEmpty, target.glob, context);
  return ifEmpty === null ? null : { verdict: "deny", rule: "unguarded-variable", path: ifEmpty.path };
}

/** The literal absolute path the target removes when it is safe to remove unattended; null otherwise. */
function safeTarget(target: Word, context: TriageContext): string | null {
  if (!target.literal || target.glob) return null;
  const path = resolvePath(target.text, context.home);
  if (path === null) return null;
  if (path.split("/").includes(".git")) return null;
  const cwd = normalizePath(context.cwd);
  if (path.startsWith("/tmp/")) return path;
  if (cwd !== "/" && cwd !== "/tmp" && path.startsWith(`${cwd}/`)) return path;
  return null;
}

/**
 * The rule a removal of this text breaks; null when it breaks none or cannot be judged (a relative
 * path, an unknown variable). A last name of only `*`, `?` or `.*` removes everything in its folder,
 * so that folder is judged as removed; any other glob cannot be judged.
 */
function dangerousPath(text: string, glob: boolean, context: TriageContext): { rule: DenyRule; path: string } | null {
  if (text.includes("\u0000")) return null;
  let candidate = text;
  if (glob) {
    const slash = candidate.lastIndexOf("/");
    const last = candidate.slice(slash + 1);
    if (/[*?[{}]/.test(candidate.slice(0, slash + 1)) || !/^(\*|\?|\.\*)+$/.test(last)) return null;
    candidate = candidate.slice(0, slash + 1);
  }
  const path = resolvePath(candidate, context.home);
  if (path === null) return null;
  const rule = ruleFor(path, context);
  return rule === null ? null : { rule, path };
}

function ruleFor(path: string, context: TriageContext): DenyRule | null {
  const home = normalizePath(context.home);
  const cwd = normalizePath(context.cwd);
  if (path === "/") return "root";
  if (path === home || parentOf(path) === home) return "home";
  if (path === cwd || cwd.startsWith(`${path}/`)) return "working-directory";
  if (SYSTEM_SCRATCH.includes(path)) return "system";
  if (SYSTEM_SCRATCH.some((scratch) => path.startsWith(`${scratch}/`))) return null;
  if (SYSTEM.some((system) => path === system || path.startsWith(`${system}/`))) return "system";
  if (parentOf(path) === "/") return "top-level";
  return null;
}

/** The absolute, normalized path of the text (`~` read as home), or null for a relative one. */
function resolvePath(text: string, home: string): string | null {
  const expanded = text.startsWith("\u0001") ? `${home}${text.slice(1)}` : text;
  if (!expanded.startsWith("/") || expanded.includes("\u0000") || expanded.includes("\u0001")) return null;
  return normalizePath(expanded);
}

export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

/** The `- <rule>: <why>` lines of `templates/permission-rules.md`, by rule. */
export function ruleReasons(template: string): Partial<Record<DenyRule, string>> {
  const reasons: Partial<Record<DenyRule, string>> = {};
  for (const line of template.split("\n")) {
    const match = /^- ([a-z-]+): (.+)$/.exec(line.trim());
    const rule = DENY_RULES.find((candidate) => candidate === match?.[1]);
    if (rule !== undefined && match?.[2] !== undefined) reasons[rule] = match[2];
  }
  return reasons;
}

/** The ticket's record of one decision the rules made (TR-143). */
export function permissionRecord(at: string, role: string, agentId: string, command: string, triage: Exclude<Triage, { verdict: "ask" }>): string {
  const oneLine = command.replace(/\s+/g, " ").trim();
  const shown = oneLine.length > 200 ? `${oneLine.slice(0, 199)}…` : oneLine;
  const outcome = triage.verdict === "allow" ? `allowed (rule ${triage.rule}: ${triage.paths.join(", ")})` : `denied (rule ${triage.rule}: ${triage.path})`;
  return `PERMISSION ${at} — ${role} ${agentId} asked to run \`${shown.replace(/`/g, "'")}\`; the plugin ${outcome}, without asking the user.`;
}

/** Whether a Paseo mode id is a provider's bypass mode, as `server/models.ts` picks it. */
export function isBypassMode(modeId: string | null | undefined): boolean {
  return typeof modeId === "string" && /bypass|full-access|yolo/i.test(modeId);
}
