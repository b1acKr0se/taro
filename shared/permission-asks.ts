/**
 * Answered permission asks (TR-149): the plugin records each ask of a Taro agent and how it ended
 * (allowed or denied, by the user or by Taro's rules of TR-143), so the chat can leave a finished
 * card where the ask happened. Paseo keeps no history of them. Pure.
 */
import { z } from "zod";

export const PermissionAskSchema = z.object({
  agentId: z.string(),
  requestId: z.string(),
  kind: z.string(),
  name: z.string(),
  /** What was asked, on one line: the shell command, the tool's title, or the questions. */
  subject: z.string(),
  askedAt: z.string(),
  answeredAt: z.string().nullable(),
  outcome: z.enum(["allowed", "denied"]).nullable(),
  by: z.enum(["you", "rules"]).nullable(),
  /** The rule that answered it; on an open ask, the rules are answering it now (set before they respond). */
  rule: z.string().nullable(),
  /** The user's words with a denial, or a question's answers. */
  words: z.string().nullable(),
});
export type PermissionAsk = z.infer<typeof PermissionAskSchema>;

/** The parts of Paseo's permission request an ask is made from. */
export interface AskRequest {
  id: string;
  name: string;
  kind: string;
  title?: string | undefined;
  description?: string | undefined;
  input?: Record<string, unknown> | undefined;
}

/** The parts of Paseo's permission resolution an answer is read from. */
export interface AskResolution {
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown> | undefined;
  message?: string | undefined;
}

const SUBJECT_LENGTH = 200;

/** Answers kept for the record this long, like decisions; an ask never answered is dropped as long after it was made. */
export const ASK_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** What Taro's own Deny and Dismiss buttons send: no words of the user's. */
const CANNED_DENIALS = new Set(["Dismissed by user", "Denied by the user from the Taro panel."]);

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > SUBJECT_LENGTH ? `${line.slice(0, SUBJECT_LENGTH - 1)}…` : line;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function questionsText(input: Record<string, unknown> | undefined): string {
  const questions = input?.questions;
  if (!Array.isArray(questions)) return "";
  return questions
    .map((question: unknown) => (typeof question === "object" && question !== null ? text((question as Record<string, unknown>).question) : ""))
    .filter((question) => question !== "")
    .join(" ");
}

/** The ask as recorded when it is made, at `at`. */
export function askFromRequest(agentId: string, request: AskRequest, at: string): PermissionAsk {
  const command = request.name === "Bash" ? text(request.input?.command) : "";
  const asked = request.kind === "question" ? questionsText(request.input) : "";
  const subject = [asked, command, text(request.title), text(request.description), request.name].find((each) => each !== "") ?? "";
  return { agentId, requestId: request.id, kind: request.kind, name: request.name, subject: oneLine(subject), askedAt: at, answeredAt: null, outcome: null, by: null, rule: null, words: null };
}

function answersText(input: Record<string, unknown> | undefined): string | null {
  const answers = input?.answers;
  if (typeof answers !== "object" || answers === null) return null;
  const parts = Object.entries(answers as Record<string, unknown>).flatMap(([header, answer]) => (typeof answer === "string" && answer.trim() !== "" ? [`${header}: ${answer.trim()}`] : []));
  return parts.length === 0 ? null : parts.join("; ");
}

/** The ask answered at `at`; `byRules` when Taro's rules answered it, whose own message is not the user's words. */
export function resolveAsk(ask: PermissionAsk, resolution: AskResolution, at: string, byRules: { rule: string } | null): PermissionAsk {
  const outcome = resolution.behavior === "allow" ? "allowed" : "denied";
  let words: string | null = null;
  if (byRules === null && outcome === "denied") {
    const message = text(resolution.message);
    words = message === "" || CANNED_DENIALS.has(message) ? null : message;
  } else if (outcome === "allowed" && ask.kind === "question") {
    words = answersText(resolution.updatedInput);
  }
  return { ...ask, answeredAt: at, outcome, by: byRules === null ? "you" : "rules", rule: byRules?.rule ?? null, words };
}

/** The asks still kept at `now`: an answered one under 14 days from its answer, an open one under 14 days from its ask (as decisions are). */
export function keptAsks(asks: readonly PermissionAsk[], now: number): PermissionAsk[] {
  return asks.filter((ask) => now - Date.parse(ask.answeredAt ?? ask.askedAt) < ASK_RETENTION_MS);
}
