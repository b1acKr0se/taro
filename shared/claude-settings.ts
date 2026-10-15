/**
 * Taro's SessionStart hook (matcher "compact") in a Claude `settings.local.json` (TR-101): after
 * every compaction, automatic ones included, Claude adds the hook's output (the reload text) to the
 * agent's context. The file may be the user's own, so the merge edits the text in place: every byte
 * outside Taro's hook entry stays as it was.
 */

/** In the hook's command, so the merge finds Taro's entry again and leaves every other one alone. */
export const TARO_HOOK_MARKER = "taro-compact-reload";

/** Seconds Claude waits for the hook; `cat` of a small file needs far less. */
const HOOK_TIMEOUT_SECONDS = 10;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Prints the agent's own reload file (`<folder>/<PASEO_AGENT_ID>.md`; one settings file serves every
 * agent in a working directory, an owner's subagents included, and they have none) while the skill
 * it names is there, and always exits 0: a moved, updated or removed plugin, or an archived agent's
 * removed file, leaves a hook that prints nothing and never fails or blocks a session.
 */
export function reloadHookCommand(reloadFolder: string, skillDirectory: string): string {
  return `[ -d ${shellQuote(skillDirectory)} ] && [ -n "$PASEO_AGENT_ID" ] && cat ${shellQuote(reloadFolder)}/"$PASEO_AGENT_ID.md" 2>/dev/null; exit 0 # ${TARO_HOOK_MARKER}`;
}

export function taroHookEntry(command: string): unknown {
  return { matcher: "compact", hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }] };
}

interface JsonNode {
  start: number;
  end: number;
  kind: "object" | "array" | "other";
  members: { key: string; node: JsonNode }[];
  elements: JsonNode[];
}

/** Offsets of an already valid JSON text's values; enough structure to edit it in place. */
function scan(text: string): JsonNode {
  let position = 0;
  const skipSpace = () => {
    while (position < text.length && /\s/.test(text[position] ?? "")) position += 1;
  };
  const stringEnd = (from: number): number => {
    let index = from + 1;
    while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
    return index + 1;
  };
  const value = (): JsonNode => {
    skipSpace();
    const start = position;
    const first = text[position];
    if (first === "{" || first === "[") {
      const node: JsonNode = { start, end: start, kind: first === "{" ? "object" : "array", members: [], elements: [] };
      const close = first === "{" ? "}" : "]";
      position += 1;
      skipSpace();
      while (text[position] !== close) {
        if (node.kind === "object") {
          const keyEnd = stringEnd(position);
          const key = JSON.parse(text.slice(position, keyEnd)) as string;
          position = keyEnd;
          skipSpace();
          position += 1; // the colon
          node.members.push({ key, node: value() });
        } else {
          node.elements.push(value());
        }
        skipSpace();
        if (text[position] === ",") position += 1;
        skipSpace();
      }
      position += 1;
      node.end = position;
      return node;
    }
    position = first === '"' ? stringEnd(position) : position + (/^[^,\]}\s]+/.exec(text.slice(position))?.[0].length ?? 1);
    return { start, end: position, kind: "other", members: [], elements: [] };
  };
  return value();
}

function lineIndent(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
}

/** The file's own indent step (its first indented line), else two spaces. */
function indentUnit(text: string): string {
  return /\n([ \t]+)\S/.exec(text)?.[1] ?? "  ";
}

/** `value` as JSON whose second and later lines start at `indent`. */
function render(value: unknown, unit: string, indent: string): string {
  return JSON.stringify(value, null, unit).replace(/\n/g, `\n${indent}`);
}

/** Text with `item` added as the last item of the object or array `container`. */
function appendItem(text: string, container: JsonNode, item: string, unit: string): string {
  const outer = lineIndent(text, container.start);
  const inner = outer + unit;
  const items = container.kind === "object" ? container.members.map((member) => member.node) : container.elements;
  const last = items[items.length - 1];
  if (last === undefined) {
    return `${text.slice(0, container.start + 1)}\n${inner}${item}\n${outer}${text.slice(container.end - 1)}`;
  }
  return `${text.slice(0, last.end)},\n${inner}${item}${text.slice(last.end)}`;
}

function isTaroEntry(text: string, node: JsonNode): boolean {
  return node.kind === "object" && text.slice(node.start, node.end).includes(TARO_HOOK_MARKER);
}

/**
 * The settings text with Taro's hook entry in it, or null when it cannot be merged without
 * rewriting what is there (not JSON, or `hooks` / `hooks.SessionStart` of an unexpected shape):
 * the file is then left alone. `text` null (no file yet) or blank gives a new file.
 */
export function withTaroHook(text: string | null, command: string): string | null {
  const entry = taroHookEntry(command);
  if (text === null || text.trim() === "") return `${JSON.stringify({ hooks: { SessionStart: [entry] } }, null, 2)}\n`;
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  const root = scan(text);
  if (root.kind !== "object") return null;
  const unit = indentUnit(text);
  const hooks = root.members.find((member) => member.key === "hooks")?.node;
  if (hooks === undefined) {
    return appendItem(text, root, `"hooks": ${render({ SessionStart: [entry] }, unit, lineIndent(text, root.start) + unit)}`, unit);
  }
  if (hooks.kind !== "object") return null;
  const sessionStart = hooks.members.find((member) => member.key === "SessionStart")?.node;
  if (sessionStart === undefined) {
    return appendItem(text, hooks, `"SessionStart": ${render([entry], unit, lineIndent(text, hooks.start) + unit)}`, unit);
  }
  if (sessionStart.kind !== "array") return null;
  const ours = sessionStart.elements.filter((element) => isTaroEntry(text, element));
  const first = ours[0];
  if (first === undefined) return appendItem(text, sessionStart, render(entry, unit, lineIndent(text, sessionStart.start) + unit), unit);
  // Replace the first in place (indented as it was) and drop any duplicates, last first so offsets hold.
  let result = text;
  for (const extra of ours.slice(1).reverse()) {
    const before = result.slice(0, extra.start).replace(/,\s*$/, "");
    result = before + result.slice(extra.end);
  }
  return result.slice(0, first.start) + render(entry, unit, lineIndent(text, first.start)) + result.slice(first.end);
}
