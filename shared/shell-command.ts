/**
 * The commands a shell command line runs, read as the shell reads it (TR-160): split at `;`, `&&`,
 * `||`, pipes, new lines and subshell parentheses, with quotes kept whole, heredoc bodies and
 * comments skipped, and shell words (`for … in`, `do`, `if`), assignments and wrappers (`time`,
 * `env -u NAME`, `timeout 300`) taken off, so `T=$(date -u …); for f in a b; do $T x; done` runs
 * `taro x`, not `-u` or `for`. Pure.
 */

export interface CommandRun {
  /** The program as written, a variable assigned earlier on the line replaced by its value. */
  program: string;
  args: string[];
  /** Its output goes to a file (`>`, `>>`), not to /dev/null. */
  writesFile: boolean;
  /** It runs inside a `while` or `until` loop, as a poll does. */
  inWaitLoop: boolean;
}

interface SimpleCommand {
  words: string[];
  writesFile: boolean;
  /** Set on the empty command a `name() {` definition leaves. */
  defines?: string;
}

const BLANK = /[ \t]/;
const ENDS_WORD = /[\s;&|<>()]/;

/** The index just past the `$(…)`, `${…}` or backticks starting at `start`. */
function skipSubstitution(text: string, start: number): number {
  if (text[start] === "`") {
    let index = start + 1;
    while (index < text.length && text[index] !== "`") index += text[index] === "\\" ? 2 : 1;
    return index + 1;
  }
  const close = text[start + 1] === "{" ? "}" : ")";
  const open = close === "}" ? "{" : "(";
  let depth = 0;
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") index += 2;
    else if (character === "'" && close === ")") index = text.indexOf("'", index + 1) === -1 ? text.length : text.indexOf("'", index + 1) + 1;
    else if (character === '"') index = skipDoubleQuoted(text, index);
    else {
      if (character === open) depth += 1;
      else if (character === close) {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
      index += 1;
    }
  }
  return text.length;
}

/** The index just past the double-quoted string starting at `start`. */
function skipDoubleQuoted(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') {
    if (text[index] === "\\") index += 2;
    else if (text[index] === "$" && (text[index + 1] === "(" || text[index + 1] === "{")) index = skipSubstitution(text, index);
    else if (text[index] === "`") index = skipSubstitution(text, index);
    else index += 1;
  }
  return index + 1;
}

/** One word starting at `start`, its quotes taken off and its substitutions kept as written. */
function readWord(text: string, start: number): { word: string; end: number } {
  let word = "";
  let index = start;
  while (index < text.length && !ENDS_WORD.test(text[index] ?? "")) {
    const character = text[index] ?? "";
    if (character === "\\") {
      if (text[index + 1] !== "\n") word += text[index + 1] ?? "";
      index += 2;
    } else if (character === "'") {
      const end = text.indexOf("'", index + 1);
      word += text.slice(index + 1, end === -1 ? text.length : end);
      index = end === -1 ? text.length : end + 1;
    } else if (character === '"') {
      const end = skipDoubleQuoted(text, index);
      word += text.slice(index + 1, end - 1);
      index = end;
    } else if ((character === "$" && (text[index + 1] === "(" || text[index + 1] === "{")) || character === "`") {
      const end = skipSubstitution(text, index);
      word += text.slice(index, end);
      index = end;
    } else {
      word += character;
      index += 1;
    }
  }
  return { word, end: index };
}

/** The line's simple commands, in order, as words. */
function simpleCommands(text: string): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  let current: SimpleCommand = { words: [], writesFile: false };
  const heredocs: { delimiter: string; stripTabs: boolean }[] = [];
  const finish = (): void => {
    if (current.words.length > 0) commands.push(current);
    current = { words: [], writesFile: false };
  };
  let index = 0;
  while (index < text.length) {
    const character = text[index] ?? "";
    if (BLANK.test(character)) {
      index += 1;
    } else if (character === "\n") {
      finish();
      index += 1;
      // A heredoc's body starts on the line after its `<<WORD` and ends at a line holding only WORD.
      heredocs.splice(0).forEach((heredoc) => {
        while (index < text.length) {
          const lineEnd = text.indexOf("\n", index) === -1 ? text.length : text.indexOf("\n", index);
          const line = text.slice(index, lineEnd);
          index = lineEnd + 1;
          if ((heredoc.stripTabs ? line.replace(/^\t+/, "") : line) === heredoc.delimiter) break;
        }
      });
    } else if (character === "#") {
      const lineEnd = text.indexOf("\n", index);
      index = lineEnd === -1 ? text.length : lineEnd;
    } else if (character === ";" || character === "|" || character === ")") {
      finish();
      index += 1;
    } else if (character === "(") {
      // `name() { …; }` defines a function: neither `name` nor its body's braces run anything.
      if (text.slice(index + 1).trimStart().startsWith(")")) {
        const name = current.words[current.words.length - 1];
        current = { words: [], writesFile: false };
        if (name !== undefined) commands.push({ words: [], writesFile: false, defines: name });
        index = text.indexOf(")", index) + 1;
      } else {
        finish();
        index += 1;
      }
    } else if (character === "&" && text[index + 1] !== ">") {
      finish();
      index += 1;
    } else if (character === "<" || character === ">" || character === "&") {
      const operator = /^(&>>?|<<<|<<-?|<>|>>|>\||>&|<&|>|<)/.exec(text.slice(index))?.[0] ?? character;
      index += operator.length;
      while (BLANK.test(text[index] ?? "")) index += 1;
      const target = readWord(text, index);
      index = target.end;
      if (operator === "<<" || operator === "<<-") heredocs.push({ delimiter: target.word, stripTabs: operator === "<<-" });
      else if (/>/.test(operator) && operator !== ">&" && target.word !== "/dev/null") current.writesFile = true;
    } else {
      const { word, end } = readWord(text, index);
      index = end;
      // `2>&1`: a file descriptor number belongs to the redirection after it.
      if (!(/^\d+$/.test(word) && (text[end] === ">" || text[end] === "<"))) current.words.push(word);
    }
  }
  finish();
  return commands;
}

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
/** Shell words that start a command line without being the program. */
const LEADING_KEYWORDS = new Set(["if", "then", "else", "elif", "while", "until", "do", "!", "{", "[[", "time", "nohup", "exec", "command", "builtin", "sudo"]);
/** Shell words whose whole command runs nothing: `for f in a b`, `case $x in`, `done`, `fi`. */
const CLAUSES = new Set(["for", "select", "case", "done", "fi", "esac", "}"]);

/** Takes `env [-i] [-u NAME] [NAME=value]…`, `timeout [-s SIG] 300` and the like off the front. */
function withoutWrapper(words: string[]): string[] | null {
  const [first, ...rest] = words;
  if (first === "env") {
    let index = 0;
    while (index < rest.length && /^-|=/.test(rest[index] ?? "")) index += rest[index] === "-u" || rest[index] === "-C" || rest[index] === "-S" ? 2 : 1;
    return rest.slice(index);
  }
  if (first === "timeout" || first === "nice" || first === "stdbuf" || first === "xargs") {
    let index = 0;
    while (index < rest.length && (rest[index] ?? "").startsWith("-")) index += /^-[skInPLd]$|^--(signal|kill-after|adjustment)$/.test(rest[index] ?? "") ? 2 : 1;
    // timeout's duration comes before the program.
    if (first === "timeout" && /^\d/.test(rest[index] ?? "")) index += 1;
    return rest.slice(index);
  }
  return null;
}

/** The commands a command line runs, in order, each with its program and arguments. */
export function commandsRun(command: string): CommandRun[] {
  const variables = new Map<string, string>();
  const functions = new Set<string>();
  // The loops a command sits in: `for` and `select` iterate, `while` and `until` wait on a condition.
  const loops: ("iterate" | "wait")[] = [];
  const runs: CommandRun[] = [];
  simpleCommands(command).forEach(({ words, writesFile, defines }) => {
    if (defines !== undefined) functions.add(defines);
    let rest = words;
    for (;;) {
      const first = rest[0];
      if (first === "for" || first === "select") loops.push("iterate");
      if (first === "while" || first === "until") loops.push("wait");
      if (first === "done") loops.pop();
      if (first === undefined || CLAUSES.has(first)) return;
      const assignment = ASSIGNMENT.exec(first);
      if (assignment !== null) {
        variables.set(assignment[1] ?? "", assignment[2] ?? "");
        rest = rest.slice(1);
      } else if (LEADING_KEYWORDS.has(first)) rest = rest.slice(1);
      else {
        const unwrapped = withoutWrapper(rest);
        if (unwrapped === null) break;
        rest = unwrapped;
      }
    }
    if (rest[0] === "export" || rest[0] === "local" || rest[0] === "declare" || rest[0] === "readonly") {
      rest.slice(1).forEach((word) => {
        const assignment = ASSIGNMENT.exec(word);
        if (assignment !== null) variables.set(assignment[1] ?? "", assignment[2] ?? "");
      });
    }
    const [program = "", ...args] = rest;
    // A function defined on the line: its body's commands were read where it was defined.
    if (functions.has(program)) return;
    const variable = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(program);
    const value = variable === null ? undefined : variables.get(variable[1] ?? "");
    // A program kept in a variable set on the line (`T=…/bin/taro; $T ticket edit`) is that value.
    runs.push({ program: value === undefined ? program : (value.trim().split(/\s+/)[0] ?? program), args, writesFile, inWaitLoop: loops.includes("wait") });
  });
  return runs;
}
