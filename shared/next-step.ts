/**
 * Which page of the skill an owner needs next, read from its ticket alone (the plugin sends it once
 * at the step's start, and `taro next <ID>` prints it again when that send was missed). An owner reads
 * the common page and its level's page up front; each later phase's page comes when the phase starts,
 * filled with the ticket's facts.
 *
 * Phases, newest first: Accept handed over → accept; the round's review recorded clean → delivery;
 * Reviewing, or every child Done → review (medium and high); the round's plan approved → build
 * (medium and high); a `complexity-` label → its level's page. No label: nothing yet (the owner rates first).
 * A reopened round (above 1) is worked as low, as an investigation that changes no code (roles/owner.md),
 * whatever the first round was rated; so is an investigation rated medium or high: light's page, its
 * own check, then the delivery.
 */
import { acceptHandoffOpen } from "./accept-stall";
import { planAnswerRecords, workApproved } from "./approval-gate";
import { executionBranch, roundRecords } from "./execution";
import { isPlanReview } from "./plan-lint";
import { reopenRound, roundBranch } from "./reopen";
import { isInvestigation, isLightLevel, type Level, ticketLevel } from "./ticket-level";

export { type Level, ticketLevel } from "./ticket-level";

export const STEP_PAGES = {
  light: "levels/light.md",
  medium: "levels/medium.md",
  high: "levels/high.md",
  build: "phases/build.md",
  review: "phases/review.md",
  delivery: "phases/delivery.md",
  accept: "phases/accept.md",
} as const;

export type StepPage = (typeof STEP_PAGES)[keyof typeof STEP_PAGES];

export interface StepChild {
  id: string;
  title: string;
  status: string;
  dependencies: readonly string[];
}

/** What the picker reads of a ticket; the delivery gaps are computed by the caller, as Accept computes them. */
export interface StepTicket {
  id: string;
  status: string;
  labels: readonly string[];
  notes: string | null;
  /** A child's parent's notes: its plan approval covers the child. */
  parentNotes?: string | null;
  children: readonly StepChild[];
  baseBranch: string;
  /** What the delivery still lacks (the evidence check, the review head and PR, FINAL, the plan), one line each. */
  deliveryGaps: readonly string[];
}

export interface Step {
  page: StepPage;
  facts: Record<string, string>;
  /**
   * The round's plan approval, when a REVIEW of the round came before it (an investigation turned into
   * a build): pages from then on are remembered apart from those sent before it, so its delivery comes again.
   */
  since?: string;
}

const FINISHED: ReadonlySet<string> = new Set(["Done", "Cancelled"]);

const isWorkReview = (record: string) => /^REVIEW\b/.test(record) && !isPlanReview(record);

/** Where the round's newest plan approval (an APPROVAL record or the user's Approve) sits among its records; -1 without one. */
function approvalIndex(records: readonly string[]): number {
  let found = -1;
  records.forEach((record, index) => {
    if (planAnswerRecords(record).some((answer) => answer.kind === "approved")) found = index;
  });
  return found;
}

/**
 * The round's newest REVIEW record of the work (a plan review before approval is not one) says nothing
 * is left to fix: `verdict: clean`. Only a REVIEW after the round's newest plan approval counts, when
 * there is one: an investigation turned into a build has its own self-check before the approval.
 */
export function reviewClean(notes: string | null): boolean {
  const records = roundRecords(notes);
  const reviews = records.slice(approvalIndex(records) + 1).filter(isWorkReview);
  const newest = reviews[reviews.length - 1];
  return newest !== undefined && /\bverdict:\s*clean\b/i.test(newest);
}

/** The round's plan approval's time when a REVIEW of the round came before it; null otherwise. */
function approvalAfterReview(notes: string | null): string | null {
  const records = roundRecords(notes);
  const index = approvalIndex(records);
  if (index < 0 || !records.slice(0, index).some(isWorkReview)) return null;
  const approved = planAnswerRecords(records[index] ?? "").filter((answer) => answer.kind === "approved");
  return approved[approved.length - 1]?.at ?? null;
}

/** Children in build order: each after the children it depends on, otherwise by id. */
export function buildOrder(children: readonly StepChild[]): StepChild[] {
  const byId = (left: StepChild, right: StepChild) => left.id.localeCompare(right.id, "en", { numeric: true });
  const remaining = [...children].sort(byId);
  const ids = new Set(remaining.map((child) => child.id));
  const placed = new Set<string>();
  const ordered: StepChild[] = [];
  while (remaining.length > 0) {
    // A dependency cycle (or one outside the children) never blocks the list: the first left goes next.
    const index = Math.max(0, remaining.findIndex((child) => child.dependencies.every((dependency) => !ids.has(dependency) || placed.has(dependency))));
    const [next] = remaining.splice(index, 1);
    if (next === undefined) break;
    ordered.push(next);
    placed.add(next.id);
  }
  return ordered;
}

function childrenFact(children: readonly StepChild[]): string {
  if (children.length === 0) return "none: build it yourself, or with implementers as your plan says.";
  return buildOrder(children)
    .map((child, index) => `${index + 1}. ${child.id} — ${child.title} (${child.status})`)
    .join("\n");
}

function everyChildDone(children: readonly StepChild[]): boolean {
  return children.length > 0 && children.every((child) => FINISHED.has(child.status)) && children.some((child) => child.status === "Done");
}

/** The page for the ticket's current step, with the facts to fill it; null when there is none (unrated, closed, or only Accept is left). */
export function nextStep(ticket: StepTicket): Step | null {
  const step = pickStep(ticket);
  const since = step === null ? null : approvalAfterReview(ticket.notes);
  return step === null || since === null ? step : { ...step, since };
}

function pickStep(ticket: StepTicket): Step | null {
  if (FINISHED.has(ticket.status)) return null;
  const rated: Level | null = ticketLevel(ticket.labels);
  if (rated === null) return null;
  const round = reopenRound(ticket.notes);
  const reopened = round > 1;
  const asLow = reopened || isInvestigation(ticket.labels);
  const level: Level = asLow ? "low" : rated;
  const worked = reopened ? `${rated}, and this reopened round is worked as low` : rated === level ? rated : `${rated}, and as an investigation it is worked as low`;
  const facts = { ticket: ticket.id, level: worked, round: String(round) };
  if (ticket.status === "Awaiting acceptance") {
    if (acceptHandoffOpen(ticket.notes)) return { page: STEP_PAGES.accept, facts };
    return ticket.deliveryGaps.length === 0 ? null : { page: STEP_PAGES.delivery, facts: { ...facts, missing: gapsFact(ticket.deliveryGaps) } };
  }
  if (reviewClean(ticket.notes)) return { page: STEP_PAGES.delivery, facts: { ...facts, missing: gapsFact(ticket.deliveryGaps) } };
  const light = isLightLevel(level);
  if (!light && (ticket.status === "Reviewing" || everyChildDone(ticket.children))) {
    const branch = executionBranch(ticket.notes) ?? roundBranch(ticket.id, round);
    return { page: STEP_PAGES.review, facts: { ...facts, range: `${ticket.baseBranch}..${branch}` } };
  }
  if (!light && workApproved(ticket.notes, ticket.parentNotes ?? null)) {
    return { page: STEP_PAGES.build, facts: { ...facts, children: childrenFact(ticket.children) } };
  }
  return { page: light ? STEP_PAGES.light : level === "medium" ? STEP_PAGES.medium : STEP_PAGES.high, facts };
}

function gapsFact(gaps: readonly string[]): string {
  return gaps.length === 0 ? "- nothing the plugin checks: finish as the page says" : gaps.map((gap) => `- ${gap}`).join("\n");
}

/** What the plugin remembers having sent: a page once per round of the ticket, and once more after an approval that followed a REVIEW. */
export function stepKey(ticket: string, step: Step): string {
  return `${ticket}#${step.facts.round ?? "1"}:${step.page}${step.since === undefined ? "" : `@${step.since}`}`;
}
