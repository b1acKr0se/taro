/**
 * Which page of the skill an owner needs next, read from its ticket alone (the plugin sends it once
 * at the step's start, and `taro next <ID>` prints it again when that send was missed). An owner reads
 * the common page and its level's page up front; each later phase's page comes when the phase starts,
 * filled with the ticket's facts.
 *
 * Phases, newest first: Accept handed over → accept; the round's review recorded clean → delivery;
 * Reviewing, or every child Done → review (medium and high); the round's plan approved → build
 * (medium and high); a `complexity-` label → its level's page. No label: nothing yet (the owner rates first).
 */
import { acceptHandoffOpen } from "./accept-stall";
import { workApproved } from "./approval-gate";
import { executionBranch, roundRecords } from "./execution";
import { reopenRound, roundBranch } from "./reopen";

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
}

export type Level = "trivial" | "low" | "medium" | "high";

const LEVELS: readonly Level[] = ["trivial", "low", "medium", "high"];
const FINISHED: ReadonlySet<string> = new Set(["Done", "Cancelled"]);

/** The ticket's level from its `complexity-` labels; the highest when there are several. Null when unrated. */
export function ticketLevel(labels: readonly string[]): Level | null {
  let found: Level | null = null;
  for (const level of LEVELS) if (labels.includes(`complexity-${level}`)) found = level;
  return found;
}

/** The round's newest REVIEW record says nothing is left to fix: `verdict: clean`. */
export function reviewClean(notes: string | null): boolean {
  const reviews = roundRecords(notes).filter((record) => /^REVIEW\b/.test(record));
  const newest = reviews[reviews.length - 1];
  return newest !== undefined && /\bverdict:\s*clean\b/i.test(newest);
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
  if (FINISHED.has(ticket.status)) return null;
  const level = ticketLevel(ticket.labels);
  if (level === null) return null;
  const round = reopenRound(ticket.notes);
  const facts = { ticket: ticket.id, level, round: String(round) };
  if (ticket.status === "Awaiting acceptance") {
    if (acceptHandoffOpen(ticket.notes)) return { page: STEP_PAGES.accept, facts };
    return ticket.deliveryGaps.length === 0 ? null : { page: STEP_PAGES.delivery, facts: { ...facts, missing: gapsFact(ticket.deliveryGaps) } };
  }
  if (reviewClean(ticket.notes)) return { page: STEP_PAGES.delivery, facts: { ...facts, missing: gapsFact(ticket.deliveryGaps) } };
  const light = level === "trivial" || level === "low";
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

/** What the plugin remembers having sent: a page once per round of the ticket. */
export function stepKey(ticket: string, step: Step): string {
  return `${ticket}#${step.facts.round ?? "1"}:${step.page}`;
}
