/**
 * The Ticket tab you can scan (TR-061, design B): a summary block that answers in about five seconds
 * (status, what the ticket needs from the user, its goal, its result once delivered), then folded
 * sections in a fixed order, each with a one-line summary. Pure; the view only draws it.
 */
import { SCOPE_APPROVAL } from "./decision-view";
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
  children: readonly { status: string | null }[];
  evidence: { checks: readonly unknown[]; screenshots: readonly unknown[] } | null;
  /** Paused by the user (TR-088): only their Resume moves it on. */
  pause?: { state: string } | null;
}

/** An open decision of this ticket (the caller picks the ticket's open ones), the parts read here. */
export interface OpenDecision {
  id: string;
  question: string;
  blocking: boolean;
}

export interface TicketSummary {
  /** "decision" while a blocking decision waits, "acceptance" while the delivery does, else "nothing". */
  need: "decision" | "acceptance" | "nothing";
  /** The words after "Needs you:". */
  needText: string;
  /** One line of Markdown inline marks. */
  goal: string;
  /** The delivery in a line (Markdown inline marks), or null before FINAL. */
  result: string | null;
}

export function ticketSummary(ticket: TicketFacts, decisions: readonly OpenDecision[]): TicketSummary {
  const blocking = decisions.filter((decision) => decision.blocking);
  const first = blocking[0];
  const more = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : "";
  const need: TicketSummary["need"] = first !== undefined ? "decision" : ticket.status === "Awaiting acceptance" ? "acceptance" : "nothing";
  const needText =
    first !== undefined
      ? `${first.id === SCOPE_APPROVAL ? "Approve the plan" : first.question}${more}`
      : need === "acceptance"
        ? "Accept or request changes"
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
  if (ticket.evidence !== null) {
    sections.push({ key: "evidence", summary: `${count(ticket.evidence.checks.length, "check", "checks")} · ${count(ticket.evidence.screenshots.length, "screenshot", "screenshots")}`, open: false });
  }
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
