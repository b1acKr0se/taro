/**
 * What a Needs you card shows of an ask in the asker's own words (TR-045): a permission request
 * as what it asks to do, a delivery as its summary's first sentence. Pure.
 */
import { finalSummaryBody } from "./execution";

/** A Paseo permission request, only the parts read here (Paseo's `AgentPermissionRequest`). */
export interface PermissionRequestParts {
  name: string;
  kind: string;
  title?: string | undefined;
  description?: string | undefined;
  input?: Record<string, unknown> | undefined;
}

export interface PermissionAsk {
  /** What is asked: the tool's title or "Allow <tool>?", or a question form's first question. */
  title: string;
  /** The command, file or address it acts on, or the request's description; one line. */
  detail: string | null;
}

/** The longest detail kept; the card shows three lines of it at most. */
const DETAIL_CHARACTERS = 240;

export function permissionAsk(request: PermissionRequestParts): PermissionAsk {
  const input = request.input ?? {};
  if (request.kind === "question") {
    const question = firstQuestion(input.questions);
    if (question !== null) return { title: question, detail: null };
  }
  if (request.kind === "plan") return { title: request.title ?? "Approve the plan", detail: firstLine(input.plan) };
  const detail = firstLine(input.command) ?? firstLine(input.file_path) ?? firstLine(input.url) ?? firstLine(request.description);
  // A bare tool name ("Bash") does not say it is asking; the question does.
  return { title: request.title ?? `Allow ${request.name}?`, detail };
}

function firstQuestion(questions: unknown): string | null {
  if (!Array.isArray(questions)) return null;
  const first: unknown = questions[0];
  if (typeof first !== "object" || first === null) return null;
  return firstLine((first as { question?: unknown }).question);
}

function firstLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const line = value.split("\n").map((part) => part.trim()).find((part) => part !== "");
  if (line === undefined) return null;
  return line.length > DETAIL_CHARACTERS ? `${line.slice(0, DETAIL_CHARACTERS - 1)}…` : line;
}

/**
 * The delivery in a line: the FINAL summary's first sentence, without its record header or Markdown
 * markers. Null when the owner wrote no summary.
 */
export function deliveredLine(finalSummary: string | null): string | null {
  if (finalSummary === null) return null;
  const line = finalSummaryBody(finalSummary)
    .split("\n")
    .map((part) => part.replace(/^\s*(?:#+|[-*+]|\d+[.)])\s+/, "").replace(/\*\*|__|`/g, "").trim())
    .find((part) => part !== "" && !/^-{3,}$/.test(part));
  if (line === undefined) return null;
  // A sentence ends at a full stop followed by a space; "v1.2" or "e.g. x" stay whole enough.
  const sentence = /^(.+?[.!?])\s+[A-Z(]/.exec(line)?.[1] ?? line;
  return sentence.length > DETAIL_CHARACTERS ? `${sentence.slice(0, DETAIL_CHARACTERS - 1)}…` : sentence;
}
