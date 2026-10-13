/**
 * What agents write for the plugin (decisions 28, 30): the status line that
 * ends every turn and the `decision` blocks that ask the user something.
 * Pure, shared by the daemon (which parses turns) and the screen (which draws
 * decision cards inline in a transcript).
 */
import { z } from "zod";

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
  for (const line of lines.slice(-STATUS_TAIL_LINES).reverse()) {
    const match = /^[`*_]*(working|waiting|blocked|done|failed)[`*_]*\s*:\s*(.+?)[`*_]*$/i.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { state: match[1].toLowerCase() as StatusState, text: match[2].trim() };
    }
  }
  return null;
}

export const DecisionOptionSchema = z.object({
  label: z.string().min(1),
  prompt: z.string().min(1),
  consequence: z.string().default(""),
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

const FENCE = /```decision[^\n]*\n([\s\S]*?)```/g;

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

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, "\n") : inner.replace(/''/g, "'");
  }
  // An unquoted value may carry a trailing ` # comment` (the format's own example does).
  return trimmed.replace(/\s+#\s.*$/, "").trim();
}

/**
 * A lenient reader for the block's small YAML shape: top-level `key: value`
 * pairs and an `options:` list of `- label: …` maps. Agents write it, so
 * anything unexpected is skipped rather than failing the whole block.
 */
export function parseDecisionBody(body: string): ParsedDecision {
  const fields: Record<string, string> = {};
  const options: Record<string, string>[] = [];
  let inOptions = false;
  let current: Record<string, string> | null = null;
  for (const rawLine of body.split("\n")) {
    if (rawLine.trim() === "" || rawLine.trim().startsWith("#")) continue;
    const indented = /^\s/.test(rawLine);
    const line = rawLine.trim();
    if (!indented) {
      inOptions = false;
      current = null;
      const pair = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
      if (pair?.[1] === undefined) continue;
      const key = pair[1].toLowerCase();
      if (key === "options" && (pair[2] ?? "").trim() === "") {
        inOptions = true;
        continue;
      }
      fields[key] = unquote(pair[2] ?? "");
      continue;
    }
    if (!inOptions) continue;
    const item = /^-\s*(.*)$/.exec(line);
    if (item !== null) {
      current = {};
      options.push(current);
      const inline = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(item[1] ?? "");
      if (inline?.[1] !== undefined) current[inline[1].toLowerCase()] = unquote(inline[2] ?? "");
      else if ((item[1] ?? "").trim() !== "") current.label = unquote(item[1] ?? "");
      continue;
    }
    const pair = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
    if (pair?.[1] !== undefined && current !== null) current[pair[1].toLowerCase()] = unquote(pair[2] ?? "");
  }

  const problems: string[] = [];
  const parsedOptions: DecisionOption[] = [];
  for (const option of options) {
    const label = option.label ?? "";
    const prompt = option.prompt ?? label;
    if (label === "") {
      problems.push("an option has no label");
      continue;
    }
    parsedOptions.push({ label, prompt, consequence: option.consequence ?? "" });
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

/** A short stable hash, for ids of blocks that forgot theirs. */
export function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
