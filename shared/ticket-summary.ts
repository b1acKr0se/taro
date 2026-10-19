/**
 * The Ticket tab you can scan (TR-061, design B): a summary block that answers in about five seconds
 * (status, what the ticket needs from the user, its goal, its result once delivered), then folded
 * sections in a fixed order, each with a one-line summary. Pure; the view only draws it.
 */
import { SCOPE_APPROVAL } from "./decision-view";
import { questionHoldingAccept, stillDelivering } from "./delivery-end";
import { descriptionParts, firstSentence, firstTextLine } from "./description";
import { finalSections } from "./final-summary";
import { kindLabel, ticketMilestones, type Milestone } from "./milestones";
import { deliveredLine, plainText } from "./needs-you";
import { parsePlan } from "./plan";

/** The parts of a loaded ticket read here (`TicketDetailView`). */
export interface TicketFacts {
  title: string;
  status: string;
  description: string | null;
  plan: string | null;
  acceptanceCriteria: readonly { checked: boolean }[];
  notes: string | null;
  finalSummary: string | null;
  /** A child's evidence is its own EVIDENCE record (TR-187); absent where the caller has none to give. */
  children: readonly { status: string | null; evidence?: EvidenceCounts | null }[];
  evidence: EvidenceCounts | null;
  /** Paused by the user (TR-088): only their Resume moves it on. */
  pause?: { state: string } | null;
  /** The owner is in a turn (TR-153): a delivery is not offered until it ends. */
  ownerRunning?: boolean;
}

interface EvidenceCounts {
  checks: readonly unknown[];
  screenshots: readonly unknown[];
}

/** An open decision of this ticket (the caller picks the ticket's open ones), the parts read here. */
export interface OpenDecision {
  id: string;
  question: string;
  blocking: boolean;
  agentRole: string;
  status: string;
}

export interface TicketSummary {
  /** "decision" while a blocking decision (or the owner question holding Accept back) waits, "acceptance" while the delivery does, else "nothing". */
  need: "decision" | "acceptance" | "nothing";
  /** The words after "Needs you:". */
  needText: string;
  /** One line of Markdown inline marks. */
  goal: string;
  /** The delivery in a line (Markdown inline marks), or null before FINAL. */
  result: string | null;
}

export function ticketSummary(ticket: TicketFacts, decisions: readonly OpenDecision[]): TicketSummary {
  // The owner's open question holds Accept back (TR-146), so it is what the delivery waits on.
  const holding = ticket.status === "Awaiting acceptance" ? questionHoldingAccept(decisions) : null;
  const blocking = decisions.filter((decision) => decision.blocking || decision === holding);
  const first = blocking[0];
  const more = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : "";
  const delivering = stillDelivering(ticket.status, ticket.ownerRunning === true ? "running" : null);
  const need: TicketSummary["need"] = first !== undefined ? "decision" : ticket.status === "Awaiting acceptance" && !delivering ? "acceptance" : "nothing";
  const needText =
    first !== undefined
      ? `${first.id === SCOPE_APPROVAL ? "Approve the plan" : first.question}${more}`
      : need === "acceptance"
        ? "Accept or request changes"
        : delivering
          ? "nothing yet, the owner is delivering"
          : ticket.pause?.state === "paused"
          ? "Resume when you want it continued"
          : `nothing, ${ticket.status}`;
  const goal = parsePlan(ticket.plan)?.goal || firstTextLine(descriptionParts(ticket.description).userWords) || ticket.title;
  return { need, needText, goal, result: resultLine(ticket.finalSummary) };
}

/** FINAL's first What changed bullet, else its first sentence; null without FINAL. */
export function resultLine(finalSummary: string | null): string | null {
  if (finalSummary === null || finalSummary.trim() === "") return null;
  return finalSections(finalSummary)?.changed[0] ?? deliveredLine(finalSummary);
}

export type TicketSectionKey = "plan" | "children" | "result" | "evidence" | "milestones" | "description" | "records";

export interface TicketSection {
  key: TicketSectionKey;
  /** One line of plain text beside the section's name. */
  summary: string;
  /** Open when the tab opens. */
  open: boolean;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The plan in a line: "N choices · <first word of Size>"; an older plan's first line; criteria met. */
export function planSummary(plan: string | null, criteria: readonly { checked: boolean }[]): string {
  const parsed = parsePlan(plan);
  if (parsed !== null) {
    const size = /^[^\s:;,.]+/.exec(plainText(parsed.size))?.[0] ?? "";
    return [parsed.choices.length === 0 ? "" : count(parsed.choices.length, "choice", "choices"), size].filter((part) => part !== "").join(" · ") || plainText(parsed.goal);
  }
  const line = firstTextLine(plan);
  if (line !== null) return line;
  return criteria.length === 0 ? "" : `${criteria.filter((criterion) => criterion.checked).length}/${criteria.length} criteria met`;
}

/**
 * The sections in their order (Plan, the children of a parent, Result, Evidence, Milestones,
 * Description, Records), each with its summary; a section with nothing to show is left out. Plan
 * opens while its scope approval waits (or in Planning), Result once FINAL exists.
 */
export function ticketSections(ticket: TicketFacts, decisions: readonly OpenDecision[]): TicketSection[] {
  const sections: TicketSection[] = [];
  const approvalOpen = decisions.some((decision) => decision.id === SCOPE_APPROVAL);
  if (ticket.plan !== null || ticket.acceptanceCriteria.length > 0 || approvalOpen) {
    sections.push({ key: "plan", summary: planSummary(ticket.plan, ticket.acceptanceCriteria), open: approvalOpen || ticket.status === "Planning" });
  }
  if (ticket.children.length > 0) {
    const done = ticket.children.filter((child) => child.status === "Done").length;
    sections.push({ key: "children", summary: `${count(ticket.children.length, "child", "children")} · ${done} done`, open: false });
  }
  const result = resultLine(ticket.finalSummary);
  if (result !== null) sections.push({ key: "result", summary: plainText(result), open: true });
  const evidence = evidenceSummary(ticket);
  if (evidence !== null) sections.push({ key: "evidence", summary: evidence, open: false });
  const milestones = ticketMilestones(ticket.notes);
  const newest = milestones[milestones.length - 1];
  if (newest !== undefined) sections.push({ key: "milestones", summary: milestoneSummary(newest), open: false });
  if (ticket.description !== null && ticket.description.trim() !== "") {
    const parts = descriptionParts(ticket.description);
    const summary = firstTextLine(parts.userWords) ?? (parts.managerNoteCount > 0 ? count(parts.managerNoteCount, "manager note", "manager notes") : "");
    sections.push({ key: "description", summary, open: false });
  }
  if (ticket.notes !== null && ticket.notes.trim() !== "") {
    sections.push({ key: "records", summary: milestones.length === 0 ? "raw notes" : count(milestones.length, "record", "records"), open: false });
  }
  return sections;
}

/**
 * The Evidence row's summary, null when there is nothing to show. A parent's row also counts its
 * children's records (TR-187), "6 of 7 children · 31 checks", as a multi-repo parent's own record
 * may come only at delivery.
 */
export function evidenceSummary(ticket: Pick<TicketFacts, "children" | "evidence">): string | null {
  const recorded = ticket.children.flatMap((child) => (child.evidence === undefined || child.evidence === null ? [] : [child.evidence]));
  if (ticket.evidence === null && recorded.length === 0) return null;
  const records = ticket.evidence === null ? recorded : [ticket.evidence, ...recorded];
  const checks = count(records.reduce((total, record) => total + record.checks.length, 0), "check", "checks");
  const screenshotTotal = records.reduce((total, record) => total + record.screenshots.length, 0);
  if (ticket.children.length === 0) return `${checks} · ${count(screenshotTotal, "screenshot", "screenshots")}`;
  const parts = [`${recorded.length} of ${count(ticket.children.length, "child", "children")}`, checks];
  if (screenshotTotal > 0) parts.push(count(screenshotTotal, "screenshot", "screenshots"));
  return parts.join(" · ");
}

/** A record in a line: its kind in plain words and its first sentence, "Acceptance — the user accepted." */
export function milestoneSummary(milestone: Milestone): string {
  const sentence = firstSentence(plainText(milestone.text));
  return sentence === "" ? kindLabel(milestone.kind) : `${kindLabel(milestone.kind)} — ${sentence}`;
}

/** The first `limit` items unless unfolded, and how many are left out. */
export function foldList<T>(items: readonly T[], limit: number, unfolded: boolean): { shown: readonly T[]; hidden: number } {
  if (unfolded || items.length <= limit) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, limit), hidden: items.length - limit };
}
