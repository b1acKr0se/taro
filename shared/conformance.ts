/**
 * Workflow conformance (TR-207): whether a ticket's trail shows the workflow the owner's rules ask
 * for (`skill/roles/owner.md`, `skill/reference/tickets.md`, the plan and FINAL templates). The
 * benchmark gates on it and `bench/conformance.ts` runs it over a whole tracker. Pure, no Node
 * imports; it runs under `node` type stripping (the benchmark), so `.ts` import extensions and
 * erasable syntax only.
 */
import { parseTicket } from "./ticket-format.ts";

export interface ConformanceViolation {
  kind: string;
  detail: string;
}

export interface ConformanceOptions {
  /** The user said to decide everything themselves: no plan approval is expected. */
  handsOff?: boolean;
  /** Nudges the plugin sent (the ticket's stats): each is the plugin correcting the owner. */
  nudges?: number;
  /** The ticket's status changes with times, as the plugin's stats record them; the sequence check needs them. */
  transitions?: { from?: string | null; to: string; at: string }[];
}

/** The plan template's sections in order, each with its limit (bullets; lines for Goal and Size). */
export const PLAN_HEADINGS: readonly { heading: string; limit: number }[] = [
  { heading: "Goal", limit: 1 },
  { heading: "Choices I made", limit: 4 },
  { heading: "What you'll see", limit: 5 },
  { heading: "Out of scope", limit: 3 },
  { heading: "How I'll prove it", limit: 4 },
  { heading: "Size", limit: 1 },
];

/** The FINAL template's sections in order, each with its bullet limit. */
export const FINAL_HEADINGS: readonly { heading: string; limit: number }[] = [
  { heading: "What changed", limit: 5 },
  { heading: "How it was verified", limit: 3 },
  { heading: "Limitations", limit: 3 },
];

/** Optional: an owner writes Rulings only when it decided something for the user; absent is never a violation. */
const RULINGS_HEADING = { heading: "Rulings", limit: 5 };

/** Tickets created before this date predate the RISKS rule (`skill/roles/owner.md`). */
export const RISKS_SINCE = "2026-10-21";

/** Records the plugin writes (or owners write) when it had to correct the workflow. */
const CORRECTION_RECORDS = ["DELIVERY-ENDED", "NO-PLAN"];

const STATUS_ORDER = ["Queued", "Planning", "In Progress", "Awaiting acceptance", "Done"];
const PAST_PLANNING = new Set(["In Progress", "Awaiting acceptance", "Done"]);
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** The notes' records: a block opens at a line that starts with a capitalised word of three letters or more. */
function records(notes: string): string[] {
  return notes
    .split(/\n(?=[A-Z][A-Z-]{2,}\b)/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

/** A markdown body split at `## ` headings: heading → the lines under it. */
function sectionsOf(body: string): { heading: string; lines: string[] }[] {
  const sections: { heading: string; lines: string[] }[] = [];
  body.split("\n").forEach((line) => {
    const heading = /^#{1,3}\s+(.+?)\s*#*$/.exec(line);
    if (heading !== null) sections.push({ heading: (heading[1] ?? "").trim(), lines: [] });
    else sections[sections.length - 1]?.lines.push(line);
  });
  return sections;
}

/** How many bullets a section has; its non-empty lines when it has none (Goal and Size are lines). */
function sizeOf(lines: string[]): number {
  const filled = lines.filter((line) => line.trim() !== "" && !/^\s*<!--/.test(line));
  const bullets = filled.filter((line) => BULLET.test(line)).length;
  return bullets > 0 ? bullets : filled.length;
}

function planViolations(plan: string): ConformanceViolation[] {
  const found: ConformanceViolation[] = [];
  const sections = sectionsOf(plan);
  PLAN_HEADINGS.forEach(({ heading, limit }) => {
    const section = sections.find((candidate) => candidate.heading.toLowerCase() === heading.toLowerCase());
    if (section === undefined) {
      found.push({ kind: "plan-section-missing", detail: `the plan has no "${heading}" section` });
      return;
    }
    const size = sizeOf(section.lines);
    if (size > limit) found.push({ kind: "plan-over-limit", detail: `"${heading}" has ${size} (limit ${limit})` });
  });
  const order = PLAN_HEADINGS.map(({ heading }) => sections.findIndex((section) => section.heading.toLowerCase() === heading.toLowerCase())).filter((index) => index >= 0);
  if (order.some((index, position) => position > 0 && index < (order[position - 1] ?? 0))) {
    found.push({ kind: "plan-section-order", detail: "the plan's sections are not in the template's order" });
  }
  return found;
}

function finalViolations(finalText: string): ConformanceViolation[] {
  const found: ConformanceViolation[] = [];
  // The marker comment and the "FINAL <time>" line are not part of any section.
  const sections = sectionsOf(finalText);
  FINAL_HEADINGS.forEach(({ heading, limit }) => {
    const section = sections.find((candidate) => candidate.heading.toLowerCase() === heading.toLowerCase());
    if (section === undefined) {
      found.push({ kind: "final-section-missing", detail: `the FINAL has no "${heading}" section` });
      return;
    }
    // The revision line closes the last section but is not a bullet of it.
    const lines = section.lines.filter((line) => !/^\s*Revision:/i.test(line));
    const bullets = lines.filter((line) => BULLET.test(line)).length;
    if (bullets > limit) found.push({ kind: "final-over-limit", detail: `"${heading}" has ${bullets} bullets (limit ${limit})` });
  });
  const rulings = sections.find((candidate) => candidate.heading.toLowerCase() === RULINGS_HEADING.heading.toLowerCase());
  if (rulings !== undefined) {
    const bullets = rulings.lines.filter((line) => !/^\s*Revision:/i.test(line) && BULLET.test(line)).length;
    if (bullets > RULINGS_HEADING.limit) found.push({ kind: "final-over-limit", detail: `"${RULINGS_HEADING.heading}" has ${bullets} bullets (limit ${RULINGS_HEADING.limit})` });
  }
  return found;
}

function statusViolations(options: ConformanceOptions, trivial: boolean): ConformanceViolation[] {
  const found: ConformanceViolation[] = [];
  let rank = 0;
  (options.transitions ?? []).forEach((transition) => {
    const next = STATUS_ORDER.indexOf(transition.to);
    if (next < 0) return;
    // Past Planning straight from Queued skips the plan (hands-off and trivial work may).
    if (next >= 2 && rank < 1 && options.handsOff !== true && !trivial) {
      found.push({ kind: "status-skip", detail: `${transition.to} at ${transition.at} straight from ${STATUS_ORDER[rank]}, no Planning` });
    }
    // Back to In Progress is allowed (changes requested, a question at delivery); any other step back, or a move out of Done, is not.
    if ((next < rank && !(transition.to === "In Progress" && rank >= 3)) || (rank === 4 && next !== 4)) {
      found.push({ kind: "status-order", detail: `${transition.to} at ${transition.at} after ${STATUS_ORDER[rank]}` });
    }
    rank = next;
  });
  return found;
}

/** What is wrong with a ticket's trail, in the order the workflow would have caught it. A clean delivered ticket gives `[]`. */
export function conformanceViolations(ticketText: string, options: ConformanceOptions = {}): ConformanceViolation[] {
  // The parser checks the id against the file name, which the caller may not have: take it from the text.
  const id = /^id:\s*"([^"]+)"/m.exec(ticketText)?.[1] ?? "ticket";
  const parsed = parseTicket(ticketText, `${id}.md`);
  if (!parsed.ok) return [{ kind: "unreadable", detail: "the ticket file does not parse" }];
  const ticket = parsed.ticket;
  const found: ConformanceViolation[] = [];
  const trivial = ticket.labels.includes("complexity-trivial");
  const notes = records(ticket.notes);
  const handsOff = options.handsOff === true || notes.some((record) => /^HANDS-OFF\b/.test(record));
  const startedBuilding = PAST_PLANNING.has(ticket.status);
  const delivered = ticket.status === "Awaiting acceptance" || ticket.status === "Done";

  found.push(...statusViolations({ ...options, handsOff }, trivial));

  if (startedBuilding && !trivial && ticket.plan.trim() === "") {
    found.push({ kind: "no-plan", detail: `${ticket.status} with no plan` });
  } else if (ticket.plan.trim() !== "" && !trivial) {
    found.push(...planViolations(ticket.plan));
  }

  const approved = notes.some((record) => /^APPROVAL\b/.test(record));
  if (startedBuilding && !approved && !trivial && !handsOff) {
    const inProgressAt = options.transitions?.find((transition) => transition.to === "In Progress")?.at;
    found.push({ kind: "no-approval", detail: `In Progress${inProgressAt === undefined ? "" : ` at ${inProgressAt}`} with no APPROVAL` });
  }

  const complexity = ticket.labels.some((label) => /^complexity-(?:low|medium|high)$/.test(label));
  if (startedBuilding && complexity && ticket.created >= RISKS_SINCE && !notes.some((record) => /^RISKS\b/.test(record))) {
    const inProgressAt = options.transitions?.find((transition) => transition.to === "In Progress")?.at;
    found.push({ kind: "no-risks", detail: `In Progress${inProgressAt === undefined ? "" : ` at ${inProgressAt}`} with no RISKS record` });
  }

  if (delivered) {
    const evidence = notes.filter((record) => /^EVIDENCE\b/.test(record)).pop();
    if (evidence === undefined) {
      found.push({ kind: "evidence-check", detail: "no EVIDENCE record" });
    } else {
      if (!/^\s*(?:[-*]\s*)?checks?\s*:/im.test(evidence)) found.push({ kind: "evidence-check", detail: "EVIDENCE has no check: line" });
      if (!/^\s*(?:[-*]\s*)?review\s*:/im.test(evidence)) found.push({ kind: "evidence-review", detail: "EVIDENCE has no review: line" });
    }
    if (ticket.finalSummary.trim() === "") found.push({ kind: "no-final", detail: `${ticket.status} with no FINAL` });
    else found.push(...finalViolations(ticket.finalSummary));
  }

  CORRECTION_RECORDS.forEach((name) => {
    const count = notes.filter((record) => record.startsWith(name)).length;
    if (count > 0) found.push({ kind: "plugin-correction", detail: `${count} ${name} record${count === 1 ? "" : "s"}` });
  });
  const heldBack = notes.filter((record) => !/^(?:EXECUTION|MILESTONE|ANSWER|DECISION)\b/.test(record) && /held back/i.test(record)).length;
  if (heldBack > 0) found.push({ kind: "plugin-correction", detail: `${heldBack} record${heldBack === 1 ? "" : "s"} saying a question was held back` });
  if ((options.nudges ?? 0) > 0) found.push({ kind: "plugin-correction", detail: `${options.nudges} nudge${options.nudges === 1 ? "" : "s"} from the plugin` });
  return found;
}
