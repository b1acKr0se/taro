/**
 * What agents write for the plugin (decisions 28, 30): the status line that
 * ends every turn and the `decision` blocks that ask the user something.
 * Pure, shared by the daemon (which parses turns) and the screen (which draws
 * decision cards inline in a transcript).
 */
import { z } from "zod";

import { isBareFileName, splitAtSeparator } from "./evidence";

export const STATUS_STATES = ["working", "waiting", "blocked", "done", "failed"] as const;
export const StatusStateSchema = z.enum(STATUS_STATES);
export type StatusState = z.infer<typeof StatusStateSchema>;

export interface StatusLine {
  state: StatusState;
  text: string;
}

/** Looked for in the last few lines only, so "the build is done: …" earlier in a reply is not a report. */
const STATUS_TAIL_LINES = 3;

export function parseStatusLine(message: string): StatusLine | null {
  const lines = message
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("```"));
  // No for…of: the screen reads status lines too, and Hermes mis-scopes its loop variable.
  const tail = lines.slice(-STATUS_TAIL_LINES).reverse();
  for (let index = 0; index < tail.length; index += 1) {
    const match = /^[`*_]*(working|waiting|blocked|done|failed)[`*_]*\s*:\s*(.+?)[`*_]*$/i.exec(tail[index] ?? "");
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { state: match[1].toLowerCase() as StatusState, text: match[2].trim() };
    }
  }
  return null;
}

/**
 * An image an option names (TR-055): a bare file name in the ticket's evidence folder and what it
 * shows. `path` is filled in when the decision is stored, and stays null when the name is not a plain
 * file name or the agent has no ticket.
 */
export const OptionImageSchema = z.object({
  file: z.string(),
  caption: z.string(),
  path: z.string().nullable().default(null),
});
export type OptionImage = z.infer<typeof OptionImageSchema>;

export const DecisionOptionSchema = z.object({
  label: z.string().min(1),
  prompt: z.string().min(1),
  consequence: z.string().default(""),
  images: z.array(OptionImageSchema).default([]),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const ParsedDecisionSchema = z.object({
  id: z.string(),
  question: z.string(),
  why: z.string().default(""),
  blocking: z.boolean().default(false),
  options: z.array(DecisionOptionSchema).default([]),
  recommended: z.string().default(""),
  reason: z.string().default(""),
  default: z.string().default(""),
  withdrawn: z.boolean().default(false),
  /** What failed validation; empty when the block is complete. */
  problems: z.array(z.string()).default([]),
});
export type ParsedDecision = z.infer<typeof ParsedDecisionSchema>;

// `taro-decision` is the renderer's own name for the block; agents write it too (TR-195).
const FENCE = /```(?:taro-)?decision(?![\w-])[^\n]*\n([\s\S]*?)```/g;

/** Every `decision` block in a message, in order. */
export function parseDecisionBlocks(message: string): ParsedDecision[] {
  const decisions: ParsedDecision[] = [];
  for (const match of message.replace(/\r\n?/g, "\n").matchAll(FENCE)) {
    if (match[1] !== undefined) decisions.push(parseDecisionBody(match[1]));
  }
  return decisions;
}

/** The message with its decision blocks removed (what the chat shows as text). */
export function withoutDecisionBlocks(message: string): string {
  return message.replace(/\r\n?/g, "\n").replace(FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export type MessageSegment = { kind: "text"; text: string } | { kind: "decision"; decision: ParsedDecision };

/**
 * A message cut into its text and its decision blocks, in order, for drawing
 * the blocks as cards inside the text; null when it holds no block. Blank text
 * between blocks is dropped.
 */
export function decisionMessageSegments(message: string): MessageSegment[] | null {
  const normalized = message.replace(/\r\n?/g, "\n");
  const segments: MessageSegment[] = [];
  let from = 0;
  for (const match of normalized.matchAll(FENCE)) {
    if (match[1] === undefined || match.index === undefined) continue;
    pushText(segments, normalized.slice(from, match.index));
    segments.push({ kind: "decision", decision: parseDecisionBody(match[1]) });
    from = match.index + match[0].length;
  }
  if (segments.length === 0) return null;
  pushText(segments, normalized.slice(from));
  return segments;
}

function pushText(segments: MessageSegment[], text: string): void {
  const trimmed = text.replace(/\n{3,}/g, "\n\n").trim();
  if (trimmed !== "") segments.push({ kind: "text", text: trimmed });
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n") : inner.replace(/''/g, "'");
  }
  // An unquoted value may carry a trailing ` # comment` (the format's own example does).
  return trimmed.replace(/\s+#\s.*$/, "").trim();
}

const KEY_VALUE = /^([A-Za-z_]+)\s*:\s*(.*)$/;
/** A block scalar header: `|` or `>`, then chomping and indentation indicators in either order, then an optional comment. */
const BLOCK_HEADER = /^([|>])([+-]?)([1-9]?)([+-]?)\s*(?:#.*)?$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * YAML folding: lines join with a space, each blank line becomes a line
 * break, and lines more indented than the rest keep their breaks.
 */
function fold(lines: string[]): string {
  let text = "";
  let previous: string | null = null;
  let blanks = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blanks++;
      continue;
    }
    if (previous !== null) {
      const keepsBreak = /^\s/.test(previous) || /^\s/.test(line);
      text += blanks > 0 ? "\n".repeat(blanks) : keepsBreak ? "\n" : " ";
    }
    text += line;
    previous = line;
    blanks = 0;
  }
  return text;
}

/**
 * The value starting after `key:` on line `start - 1`, with the lines that
 * continue it: every following line indented past `keyColumn` (blank lines
 * included). Handles `|` / `>` block scalars and plain or quoted values
 * written over several lines. Trailing line breaks are dropped whatever the
 * chomping indicator says, since values are shown as text and matched
 * against labels.
 */
function readValue(lines: string[], start: number, keyColumn: number, rest: string): { value: string; next: number } {
  let next = start;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    if (indentOf(line) <= keyColumn) break;
    next = index + 1;
  }
  const continuation = lines.slice(start, next);
  const header = BLOCK_HEADER.exec(rest.trim());
  if (header !== null) {
    const indicator = header[3] ?? "";
    const firstContent = continuation.find((line) => line.trim() !== "");
    const contentIndent = indicator !== "" ? keyColumn + Number(indicator) : firstContent === undefined ? 0 : indentOf(firstContent);
    // A line indented less than the content but past the key is lenient input, kept without its indentation.
    const content = continuation.map((line) => (indentOf(line) >= contentIndent ? line.slice(contentIndent) : line.trimStart()));
    const text = header[1] === "|" ? content.join("\n") : fold(content);
    return { value: text.replace(/\s+$/, ""), next };
  }
  const first = rest.trim();
  const quoted = first.startsWith('"') || first.startsWith("'");
  // A comment line ends a plain value in YAML; inside quotes it is text.
  const parts = continuation.map((line) => line.trim()).filter((line) => quoted || !line.startsWith("#"));
  return { value: unquote(fold(first === "" ? parts : [first, ...parts])), next };
}

/**
 * An option's `images:` value, one image per line: `file — caption`, as a block scalar, a YAML list
 * (`- file — caption`, under the key or at its own indent, as YAML allows), or a single image on the
 * key's own line. `itemColumn` is the option's own `-`: a list item at or before it is the next option.
 */
function readImages(lines: string[], start: number, keyColumn: number, itemColumn: number, rest: string): { images: OptionImage[]; next: number } {
  let next = start;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    const sameIndentItem = indent === keyColumn && indent > itemColumn && line.trim().startsWith("-");
    if (indent <= keyColumn && !sameIndentItem) break;
    next = index + 1;
  }
  const first = BLOCK_HEADER.test(rest.trim()) ? [] : [rest];
  const images = [...first, ...lines.slice(start, next)]
    .map((line) => imageLine(line.trim().replace(/^-\s*/, "")))
    .filter((line) => line !== "")
    .map((line) => {
      const [file, caption] = splitAtSeparator(line);
      // Comments are gone already (imageLine): only quotes around the file or the caption are left.
      const bare = (text: string) => (/^(["']).*\1$/.test(text) ? unquote(text) : text);
      return { file: bare(file).replace(/^`+|`+$/g, ""), caption: bare(caption), path: null };
    });
  return { images, next };
}

/** One image line without its YAML dressing: a line quoted whole loses its quotes, a ` #` comment outside quotes goes. */
function imageLine(line: string): string {
  const quote = line[0];
  if (quote === '"' || quote === "'") {
    const close = line.indexOf(quote, 1);
    // `"file" — caption` quotes only the file: that is split later, not here.
    if (close > 0 && /^\s*(?:#.*)?$/.test(line.slice(close + 1))) return line.slice(1, close);
  }
  if (line.startsWith("#")) return "";
  return line.replace(/\s+#.*$/, "").trim();
}

/**
 * A lenient reader for the block's small YAML shape: top-level `key: value`
 * pairs and an `options:` list of `- label: …` maps, where any value may run
 * over several lines. Agents write it, so anything unexpected is skipped
 * rather than failing the whole block.
 */
export function parseDecisionBody(body: string): ParsedDecision {
  if (body.trimStart().startsWith("{")) {
    const fromJson = parseJsonDecisionBody(body);
    if (fromJson !== null) return fromJson;
  }
  const fields: Record<string, string> = {};
  const options: Record<string, string>[] = [];
  const images = new Map<Record<string, string>, OptionImage[]>();
  let inOptions = false;
  let itemColumn = 0;
  let current: Record<string, string> | null = null;
  const lines = body.split("\n");
  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index] ?? "";
    index++;
    if (rawLine.trim() === "" || rawLine.trim().startsWith("#")) continue;
    const indent = indentOf(rawLine);
    const line = rawLine.trim();
    if (indent === 0) {
      inOptions = false;
      current = null;
      const pair = KEY_VALUE.exec(line);
      if (pair?.[1] === undefined) continue;
      const key = pair[1].toLowerCase();
      if (key === "options" && (pair[2] ?? "").trim() === "") {
        inOptions = true;
        continue;
      }
      const read = readValue(lines, index, 0, pair[2] ?? "");
      fields[key] = read.value;
      index = read.next;
      continue;
    }
    if (!inOptions) continue;
    const item = /^-\s*(.*)$/.exec(line);
    if (item !== null) {
      itemColumn = indent;
      current = {};
      options.push(current);
      const content = item[1] ?? "";
      const inline = KEY_VALUE.exec(content);
      if (inline?.[1] !== undefined && inline[1].toLowerCase() === "images") {
        const read = readImages(lines, index, indent + line.length - content.length, indent, inline[2] ?? "");
        images.set(current, read.images);
        index = read.next;
      } else if (inline?.[1] !== undefined) {
        const read = readValue(lines, index, indent + line.length - content.length, inline[2] ?? "");
        current[inline[1].toLowerCase()] = read.value;
        index = read.next;
      } else if (content.trim() !== "") {
        const read = readValue(lines, index, indent, content);
        current.label = read.value;
        index = read.next;
      }
      continue;
    }
    const pair = KEY_VALUE.exec(line);
    if (pair?.[1] !== undefined && current !== null && pair[1].toLowerCase() === "images") {
      const read = readImages(lines, index, indent, itemColumn, pair[2] ?? "");
      images.set(current, read.images);
      index = read.next;
    } else if (pair?.[1] !== undefined && current !== null) {
      const read = readValue(lines, index, indent, pair[2] ?? "");
      current[pair[1].toLowerCase()] = read.value;
      index = read.next;
    }
  }

  return completeDecision(fields, options, images);
}

/** A body written as a JSON object (same fields as the YAML); null when it is not valid JSON of that shape. */
function parseJsonDecisionBody(body: string): ParsedDecision | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "");
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) if (key !== "options") fields[key.toLowerCase()] = text(value);
  const options: Record<string, string>[] = [];
  const images = new Map<Record<string, string>, OptionImage[]>();
  for (const raw of Array.isArray(record.options) ? record.options : []) {
    const entry: Record<string, string> = {};
    if (typeof raw === "string") entry.label = raw;
    else if (typeof raw === "object" && raw !== null) {
      for (const [key, value] of Object.entries(raw)) if (key !== "images") entry[key.toLowerCase()] = text(value);
      const listed = (raw as { images?: unknown }).images;
      if (Array.isArray(listed)) {
        images.set(
          entry,
          listed.flatMap((image: unknown) => {
            if (typeof image !== "object" || image === null) return [];
            const { file, caption } = image as { file?: unknown; caption?: unknown };
            return [{ file: text(file), caption: text(caption), path: null }];
          }),
        );
      }
    }
    options.push(entry);
  }
  return completeDecision(fields, options, images);
}

function completeDecision(fields: Record<string, string>, options: Record<string, string>[], images: Map<Record<string, string>, OptionImage[]>): ParsedDecision {
  const problems: string[] = [];
  const parsedOptions: DecisionOption[] = [];
  for (const option of options) {
    const label = option.label ?? "";
    // An empty prompt (`prompt: |` with nothing under it) sends the label.
    const prompt = option.prompt === undefined || option.prompt === "" ? label : option.prompt;
    if (label === "") {
      problems.push("an option has no label");
      continue;
    }
    const optionImages = images.get(option) ?? [];
    for (const image of optionImages) {
      if (!isBareFileName(image.file)) problems.push(`image ${image.file} of option ${label} is not a plain file name (no folders)`);
      if (image.caption === "") problems.push(`image ${image.file} of option ${label} has no caption`);
    }
    parsedOptions.push({ label, prompt, consequence: option.consequence ?? "", images: optionImages });
  }
  const question = fields.question ?? "";
  if (question === "") problems.push("no question");
  if (parsedOptions.length === 0) problems.push("no options");
  const recommended = fields.recommended ?? "";
  if (recommended === "") problems.push("no recommended option");
  else if (parsedOptions.length > 0 && !parsedOptions.some((option) => option.label === recommended)) problems.push("recommended names no option");
  if ((fields.reason ?? "") === "") problems.push("no reason for the recommendation");
  const id = fields.id ?? "";
  if (id === "") problems.push("no id");
  return {
    id: id === "" ? `untitled-${hashText(question)}` : id,
    question,
    why: fields.why ?? "",
    blocking: /^(true|yes)$/i.test(fields.blocking ?? ""),
    options: parsedOptions,
    recommended,
    reason: fields.reason ?? "",
    default: fields.default ?? "",
    withdrawn: /^withdrawn$/i.test(fields.status ?? ""),
    problems,
  };
}

/** The options with each image's path in the ticket's evidence folder; a name with a folder in it, or no folder at all, keeps none. */
export function withImagePaths(options: readonly DecisionOption[], folder: string | null): DecisionOption[] {
  return options.map((option) => ({
    ...option,
    images: option.images.map((image) => ({ ...image, path: folder !== null && isBareFileName(image.file) ? `${folder}/${image.file}` : null })),
  }));
}

/** Whether a block asks exactly what a stored decision asked. */
export function sameQuestion(left: Pick<ParsedDecision, "question" | "options" | "blocking">, right: Pick<ParsedDecision, "question" | "options" | "blocking">): boolean {
  return (
    left.question === right.question &&
    left.blocking === right.blocking &&
    JSON.stringify(left.options.map((option) => [option.label, option.prompt])) === JSON.stringify(right.options.map((option) => [option.label, option.prompt]))
  );
}

/**
 * Whether a block is an answered decision seen again (a repeated hook, the reconcile after a restart)
 * rather than asked again (TR-108). A plan approval reads the same every round, so the turn decides
 * when both are known; a decision stored before turns were recorded falls back to the question.
 */
export function seenAgain(stored: Pick<ParsedDecision, "question" | "options" | "blocking"> & { turn: string | null }, block: Pick<ParsedDecision, "question" | "options" | "blocking">, turn: string | null): boolean {
  if (stored.turn !== null && turn !== null) return stored.turn === turn;
  return sameQuestion(stored, block);
}

/** A short stable hash, for ids of blocks that forgot theirs. */
export function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
