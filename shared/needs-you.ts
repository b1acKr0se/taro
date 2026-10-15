/**
 * What a Needs you card shows of an ask in the asker's own words (TR-045): a permission request
 * as what it asks to do, a delivery as its summary's first sentence. Pure.
 */
import { finalSummaryBody } from "./execution";
import { finalSections } from "./final-summary";
import { roleFromLabel, TARO_LABELS, type Role } from "./project";

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

/** A live agent waiting on permission requests, only the parts read here. */
export interface AskingAgent {
  id: string;
  labels: Readonly<Record<string, string>>;
  workspaceId?: string | null | undefined;
  pendingPermissions: readonly (Omit<PermissionRequestParts, "input"> & { id: string; input?: Record<string, unknown> | null })[];
}

/** What the first of several asking agents asks, who asks it, and how many requests wait in all (TR-096). */
export interface AgentAsk extends PermissionAsk {
  /** The request's id: a second ask is told from the first for its notification (TR-059). */
  id: string;
  agentId: string;
  role: Role | null;
  workspaceId: string | null;
  count: number;
}

/** The ask the card shows, from the agents waiting on a permission in the order they are shown; null when none waits. */
export function firstAsk(askers: readonly AskingAgent[]): AgentAsk | null {
  const agent = askers.find((candidate) => candidate.pendingPermissions.length > 0);
  const request = agent?.pendingPermissions[0];
  if (agent === undefined || request === undefined) return null;
  return {
    ...permissionAsk({ ...request, input: request.input ?? undefined }),
    id: request.id,
    agentId: agent.id,
    role: roleFromLabel(agent.labels[TARO_LABELS.role]),
    workspaceId: agent.workspaceId ?? null,
    count: askers.reduce((sum, candidate) => sum + candidate.pendingPermissions.length, 0),
  };
}

/** Who asks, in the words of an ask line: none for the owner, whose card it is; its job for a subagent ("researcher asks: …"). */
export function askerPrefix(role: Role | null): string | null {
  return role === null || role === "owner" ? null : role === "manager" ? "The manager asks" : `${role.charAt(0).toUpperCase()}${role.slice(1)} asks`;
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
 * The delivery in a line: the first What changed bullet of a FINAL in the template's format
 * (TR-061), else the summary's first sentence, as plain text (TR-048), without its record header,
 * HTML, Markdown or code markup. Null when the owner wrote no summary.
 */
export function deliveredLine(finalSummary: string | null): string | null {
  if (finalSummary === null) return null;
  const changed = finalSections(finalSummary)?.changed[0];
  const line = (changed ?? finalSummaryBody(finalSummary))
    // A fenced block's fences go; a line made only of markup (an HTML block, a rule) reads empty and is skipped.
    .split("\n")
    .filter((part) => !/^\s*(?:```|~~~)/.test(part) && !/^\s*(?:[-*_=]\s*){3,}$/.test(part))
    .map((part) => plainText(part.replace(/^\s*(?:>\s*)*(?:#+|[-*+]|\d+[.)])\s+/, "").replace(/^\s*>\s*/, "")))
    .find((part) => part !== "");
  if (line === undefined) return null;
  // A sentence ends at a full stop followed by a space; "v1.2" or "e.g. x" stay whole enough.
  const sentence = /^(.+?[.!?])\s+[A-Z(]/.exec(line)?.[1] ?? line;
  return sentence.length > DETAIL_CHARACTERS ? `${sentence.slice(0, DETAIL_CHARACTERS - 1)}…` : sentence;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * One line of Markdown as the words a reader sees: HTML tags dropped, an image by its alt text, a link
 * by its text, emphasis, strike-through and code marks gone, entities decoded, brackets left empty by
 * the stripping removed, whitespace collapsed.
 */
export function plainText(line: string): string {
  return (
    line
      .replace(/<!--.*?(?:-->|$)/g, " ")
      .replace(/<\/?[A-Za-z][^>]*>/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*|__|~~|`+/g, "")
      // Single emphasis only where it wraps words, so "5 * 3" and "file_name" keep theirs.
      .replace(/(^|[\s(])[*_](?=\S)([^*_]*?\S)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole: string, name: string) => entity(whole, name))
      .replace(/\s+/g, " ")
      .replace(/\s*\(\s*\)|\s*\[\s*\]/g, "")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim()
  );
}

function entity(whole: string, name: string): string {
  const lower = name.toLowerCase();
  if (!lower.startsWith("#")) return ENTITIES[lower] ?? whole;
  const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
  // Past Unicode's last code point there is no character; the text stays as written.
  return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
}
