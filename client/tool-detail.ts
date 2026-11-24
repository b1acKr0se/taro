/**
 * What the tool-call modal shows of one call: the whole call, its result and its time. Pure, so vitest
 * reads it. Paseo records each tool's own fields (a shell's output and exit code, a read's content…),
 * which this turns into two blocks of text; a detail it does not know is shown as its raw input and output.
 */
import { formatDuration } from "./format";

/** Longest result drawn: a build log can run to megabytes, and one `Text` that long freezes a phone. */
export const RESULT_LIMIT = 20_000;

export interface ToolText {
  /** The command, path, query or URL, whole. */
  call: string;
  /** The output, the file's content, the diff, the page; empty when the call recorded none. */
  result: string;
  /** "exit code 1", "HTTP 404": what the result adds to its heading, when the tool reports one. */
  outcome?: string;
  /** What the call recorded as its own duration. */
  durationMs?: number;
}

/**
 * Terminal colour codes and control characters out of the text: a command's output carries them, the
 * modal's text does not interpret them, and each one would draw as an empty box.
 */
export function readable(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

function text(value: unknown): string {
  return typeof value === "string" ? readable(value) : "";
}

function json(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return readable(value);
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A failed call's error: the words of an Error-shaped value, or the value as text. */
export function errorWords(error: unknown): string {
  if (error === undefined || error === null) return "";
  if (typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  // Claude's failed call arrives as its tool result: {type: "tool_result", content, is_error, tool_use_id}.
  if (typeof error === "object" && "content" in error) {
    const content = error.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const words = content.map((part) => (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "")).filter((part) => part !== "");
      if (words.length > 0) return words.join("\n");
    }
  }
  return json(error);
}

/** The call and result of one tool call by its detail's type. */
export function toolText(detail: unknown): ToolText {
  const d = (typeof detail === "object" && detail !== null ? detail : {}) as Record<string, unknown>;
  switch (d.type) {
    case "shell": {
      const exitCode = number(d.exitCode);
      return { call: text(d.command), result: text(d.output), ...(exitCode === undefined ? {} : { outcome: `exit code ${exitCode}` }) };
    }
    case "read": {
      const offset = number(d.offset);
      const limit = number(d.limit);
      const range = offset === undefined && limit === undefined ? "" : ` (from line ${offset ?? 1}${limit === undefined ? "" : `, ${limit} lines`})`;
      return { call: `${text(d.filePath)}${range}`, result: text(d.content) };
    }
    case "edit": {
      const diff = text(d.unifiedDiff);
      const result = diff !== "" ? diff : [text(d.oldString) === "" ? "" : `- ${text(d.oldString)}`, text(d.newString) === "" ? "" : `+ ${text(d.newString)}`].filter((line) => line !== "").join("\n");
      return { call: text(d.filePath), result };
    }
    case "write":
      return { call: text(d.filePath), result: text(d.content) };
    case "search": {
      const web = Array.isArray(d.webResults) ? d.webResults.map((hit) => `${text((hit as Record<string, unknown>).title)}\n${text((hit as Record<string, unknown>).url)}`).join("\n\n") : "";
      const files = Array.isArray(d.filePaths) ? d.filePaths.filter((path) => typeof path === "string").join("\n") : "";
      const durationMs = number(d.durationMs) ?? (number(d.durationSeconds) === undefined ? undefined : (number(d.durationSeconds) ?? 0) * 1000);
      return { call: text(d.query), result: text(d.content) || files || web, ...(durationMs === undefined ? {} : { durationMs }) };
    }
    case "fetch": {
      const code = number(d.code);
      const durationMs = number(d.durationMs);
      const prompt = text(d.prompt);
      return {
        call: prompt === "" ? text(d.url) : `${text(d.url)}\n${prompt}`,
        result: text(d.result),
        ...(code === undefined ? {} : { outcome: `HTTP ${code}${text(d.codeText) === "" ? "" : ` ${text(d.codeText)}`}` }),
        ...(durationMs === undefined ? {} : { durationMs }),
      };
    }
    case "worktree_setup":
      return { call: text(d.branchName), result: text(d.log) };
    case "sub_agent":
      return { call: [text(d.subAgentType), text(d.description)].filter((part) => part !== "").join(": "), result: text(d.log) };
    case "plain_text":
      return { call: text(d.label), result: text(d.text) };
    case "plan":
      return { call: "", result: text(d.text) };
    default:
      return { call: json(d.input), result: json(d.output) };
  }
}

/** `value` cut to `RESULT_LIMIT` characters, with how much was left out. */
export function cutResult(value: string): { shown: string; cut: number } {
  return value.length <= RESULT_LIMIT ? { shown: value, cut: 0 } : { shown: value.slice(0, RESULT_LIMIT), cut: value.length - RESULT_LIMIT };
}

export interface ToolTiming {
  /** Follows the status word: "for 12s" (after "Running"), "took 5s · finished 07:17:50", "finished 07:17:50". */
  text: string;
  /** Whether the text changes with the clock, so the modal ticks. */
  ticking: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A time of day with seconds, in local time. */
function clockWithSeconds(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function span(ms: number): string {
  return ms < 1000 ? "under 1s" : formatDuration(ms);
}

/**
 * A call's time. Paseo records when a call last changed (`changedAt`), not when it began: a running
 * call has not changed since it started, so that is its start; a finished call's duration is known only
 * from its own field (`ownMs`) or from the chat having watched it run (`watchedStartedAt`), else
 * only when it finished.
 */
export function toolTiming(input: { status: string; changedAt: string | undefined; now: number; watchedStartedAt?: number; ownMs?: number }): ToolTiming {
  const changed = input.changedAt === undefined ? Number.NaN : Date.parse(input.changedAt);
  if (input.status === "running") {
    const startedAt = input.watchedStartedAt ?? changed;
    return Number.isFinite(startedAt) ? { text: `for ${span(Math.max(0, input.now - startedAt))}`, ticking: true } : { text: "", ticking: false };
  }
  const finished = Number.isFinite(changed) ? `finished ${clockWithSeconds(changed)}` : "";
  const watched = input.watchedStartedAt !== undefined && Number.isFinite(changed) && changed >= input.watchedStartedAt ? changed - input.watchedStartedAt : undefined;
  const took = input.ownMs ?? watched;
  return { text: [took === undefined ? "" : `took ${span(took)}`, finished].filter((part) => part !== "").join(" · "), ticking: false };
}
