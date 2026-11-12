/**
 * The plan approval as a gate (TR-263). Before the round's plan is approved, a medium or high owner
 * builds nothing (a NO-APPROVAL record and a stop). After it, the owner decides inside the approved
 * goal and records a RULING: the user is asked again only when an approved criterion or an Out of
 * scope line would change, and the decision block says which in its `surprise:` field. Without one,
 * the plan approval is not shown again, and any other blocking question is shown not blocking, with
 * the default the owner goes on with (or not at all when it has none).
 *
 * Pure and free of packages, with `.ts` import extensions, so the workflow conformance check
 * (`shared/conformance.ts`) can run it under plain `node` as the benchmark does.
 */
import { lacksPlan, mayBuildBeforePlan } from "./no-plan.ts";
import { reopenRound, roundNotes } from "./reopen.ts";

/** The preset id of an owner's scope approval (`skill/reference/formats.md`). */
export const SCOPE_APPROVAL = "scope-approval";
/** The question an investigation once delivered with; one still open from before is never taken back. */
export const INVESTIGATION_DONE = "investigation-done";

/** How the user last answered a plan: Approve (or an APPROVAL record), Request changes, or another option. */
export type PlanAnswerKind = "approved" | "changes requested" | "answered";

/** A record of the user answering a plan. */
export interface PlanAnswerRecord {
  /** The record's line as written, to find the tracker commit that added it. */
  line: string;
  at: string;
  kind: PlanAnswerKind;
}

const ANSWER = /^ANSWER (\S+) — scope-approval: ".*" → (.*)$/;
const APPROVAL = /^APPROVAL (\S+) — /;

/** `Approve ("Approve")` is approval; typed words, bare or with Request changes, never are (TR-140). */
function answerKind(answer: string): PlanAnswerKind {
  if (answer.startsWith('"')) return "changes requested";
  const label = answer.split(' ("')[0]?.trim() ?? "";
  if (label === "Approve") return "approved";
  if (label === "" || label === "Request changes") return "changes requested";
  return "answered";
}

/** The notes' plan answers and APPROVAL records, in the notes' order. */
export function planAnswerRecords(notes: string | null): PlanAnswerRecord[] {
  if (notes === null) return [];
  return notes.split("\n").flatMap((raw): PlanAnswerRecord[] => {
    const line = raw.trim();
    const answer = ANSWER.exec(line);
    if (answer !== null && answer[1] !== undefined && answer[2] !== undefined) return [{ line, at: answer[1], kind: answerKind(answer[2]) }];
    const approval = APPROVAL.exec(line);
    return approval !== null && approval[1] !== undefined ? [{ line, at: approval[1], kind: "approved" }] : [];
  });
}

/** The newest plan answer or APPROVAL record of the round in progress (TR-229); null when the user has not answered its plan yet. */
export function lastPlanAnswer(notes: string | null): PlanAnswerRecord | null {
  const records = planAnswerRecords(roundNotes(notes));
  return records[records.length - 1] ?? null;
}

/**
 * Whether the round in progress has its plan approved: an Approve or an APPROVAL record after the
 * latest REOPENED. A later Request changes answers only the surprise it was asked again for, so the
 * round stays approved; only a reopened round needs approval again.
 */
export function approvedInRound(notes: string | null): boolean {
  return planAnswerRecords(roundNotes(notes)).some((record) => record.kind === "approved");
}

/** The parent of a child ticket (`TR-263.02` → `TR-263`); null for a top-level one. */
export function parentTicketId(ticket: string): string | null {
  return /^(.*)\.\d+$/.exec(ticket)?.[1] ?? null;
}

/** Whether the work is approved: in its own round, or, for a child, in its parent's round, whose approval covers it. */
export function workApproved(notes: string | null, parentNotes: string | null = null): boolean {
  return approvedInRound(notes) || approvedInRound(parentNotes);
}

/** Statuses after which nobody builds on the ticket any more. */
const CLOSED: ReadonlySet<string> = new Set(["Done", "Cancelled"]);

export type BuildGap = "no-plan" | "no-approval";

/**
 * What an owner's commits came before, for a ticket still worked on: its plan (NO-PLAN, TR-206) or,
 * with a plan, the round's approval of it (NO-APPROVAL). A trivial or low ticket may build first (TR-241),
 * and so may a reopened round, worked as low whatever the ticket was rated (`shared/next-step.ts`).
 */
export function buildGap(ticket: { status: string; plan: string | null; criteria: number; labels: readonly string[]; notes: string | null; parentNotes?: string | null }): BuildGap | null {
  if (CLOSED.has(ticket.status) || mayBuildBeforePlan(ticket.labels) || reopenRound(ticket.notes) > 1) return null;
  if (lacksPlan(ticket)) return "no-plan";
  return workApproved(ticket.notes, ticket.parentNotes ?? null) ? null : "no-approval";
}

export function noApprovalRecord(at: string, commits: number, branch: string, base: string): string {
  const counted = commits === 1 ? "1 commit" : `${commits} commits`;
  return `NO-APPROVAL ${at} — ${counted} on ${branch} past ${base} with the plan not approved this round: the owner was told to stop and ask scope-approval`;
}

/** What the plugin does with an owner's decision block once the work is approved. */
export type GateOutcome =
  /** Shown as asked. */
  | "ask"
  /** A plan approval asked again: not shown. */
  | "refuse"
  /** Several questions on one card after approval: not shown, the owner asks one at a time. */
  | "single"
  /** A blocking question: shown not blocking, the owner going on with its default. */
  | "default"
  /** A blocking question with no default to go on with: not shown. */
  | "hold";

/** The gate for one block: only after approval, and never for a block that names its surprise. */
export function approvalGate(block: { id: string; blocking: boolean; default: string; surprise?: string | undefined; questions?: readonly unknown[] | undefined }, approved: boolean): GateOutcome {
  if (!approved) return "ask";
  // One card of several questions is for the plan stage; after approval each question comes alone, surprise or not.
  if ((block.questions?.length ?? 0) > 0) return "single";
  if ((block.surprise ?? "").trim() !== "") return "ask";
  if (block.id === SCOPE_APPROVAL) return "refuse";
  if (!block.blocking) return "ask";
  return block.default.trim() === "" ? "hold" : "default";
}

/** The ticket's record of a block the gate did not show as asked; null for one shown as asked. */
export function gateRecord(at: string, outcome: GateOutcome, block: { id: string; default: string }): string | null {
  if (outcome === "refuse") return `APPROVAL-REPEATED ${at} — \`${block.id}\` asked again after the plan was approved, with no surprise: not shown; the owner was told to build on`;
  if (outcome === "single") return `BLOCKING-AFTER-APPROVAL ${at} — \`${block.id}\` asked several questions on one card after approval: not shown; the owner was told to ask one at a time`;
  if (outcome === "default") return `BLOCKING-AFTER-APPROVAL ${at} — \`${block.id}\` asked blocking after approval, with no surprise: shown not blocking, the owner going on with "${block.default.trim()}"`;
  if (outcome === "hold") return `BLOCKING-AFTER-APPROVAL ${at} — \`${block.id}\` asked blocking after approval, with no surprise and no default: not shown`;
  return null;
}
