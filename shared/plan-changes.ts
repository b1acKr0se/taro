/**
 * What changed in a plan since the one the user last answered (TR-151): a plan asked again after
 * Approve or Request changes shows its new or changed parts in green. The earlier plan is the
 * ticket's plan just before the newest plan answer (a scope-approval ANSWER or an APPROVAL record),
 * read from the tracker's history by the server. A bullet, or a Goal or Size line, is changed when
 * the earlier plan's same section has no bullet or line with the same words. Pure.
 */
import { z } from "zod";

import type { ParsedPlan, PlanSection } from "./plan";

/** How the user last answered a plan: Approve (or an APPROVAL record), Request changes, or another option. */
export const PlanAnswerKindSchema = z.enum(["approved", "changes requested", "answered"]);
export type PlanAnswerKind = z.infer<typeof PlanAnswerKindSchema>;

/** The newest record of the user answering a plan. */
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

/** The notes' newest plan answer or APPROVAL record; null when the user has not answered a plan yet. */
export function lastPlanAnswer(notes: string | null): PlanAnswerRecord | null {
  const records = planAnswerRecords(notes);
  return records[records.length - 1] ?? null;
}

export interface SectionChanges {
  /** The section's lines that are not bullets changed. */
  prose: boolean;
  /** Per bullet, in order: new or changed. */
  items: boolean[];
}

export interface PlanChanges {
  /** Per section of the current plan, in its order. */
  sections: SectionChanges[];
  goal: boolean;
  size: boolean;
  /** Per choice, in order. */
  choices: boolean[];
  /** Anything at all is new or changed. */
  any: boolean;
}

function words(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sameSection(left: PlanSection, right: PlanSection): boolean {
  if (left.key !== null || right.key !== null) return left.key === right.key;
  return words(left.heading).toLowerCase() === words(right.heading).toLowerCase();
}

/** Nothing marked: a first plan, or one the user has not answered since it changed. */
export function noPlanChanges(plan: ParsedPlan): PlanChanges {
  return {
    sections: plan.sections.map((section) => ({ prose: false, items: section.items.map(() => false) })),
    goal: false,
    size: false,
    choices: plan.choices.map(() => false),
    any: false,
  };
}

/** What in `current` is new or changed since `previous`; nothing when there is no earlier plan in the template's shape. */
export function planChanges(previous: ParsedPlan | null, current: ParsedPlan): PlanChanges {
  if (previous === null) return noPlanChanges(current);
  const sections = current.sections.map((section) => {
    const before = previous.sections.find((each) => sameSection(each, section));
    const earlierItems = new Set((before?.items ?? []).map(words));
    return {
      prose: words(section.prose) !== "" && words(section.prose) !== words(before?.prose ?? ""),
      items: section.items.map((item) => !earlierItems.has(words(item))),
    };
  });
  // Goal and Size are one line each, whether written as prose or as a bullet.
  const goal = words(current.goal) !== "" && words(current.goal) !== words(previous.goal);
  const size = words(current.size) !== "" && words(current.size) !== words(previous.size);
  const lineSection = (key: "goal" | "size", changed: boolean) => {
    const index = current.sections.findIndex((section) => section.key === key);
    const section = current.sections[index];
    if (section === undefined) return;
    sections[index] = { prose: changed && words(section.prose) !== "", items: section.items.map(() => changed) };
  };
  lineSection("goal", goal);
  lineSection("size", size);
  const choices = sections[current.sections.findIndex((section) => section.key === "choices")]?.items ?? current.choices.map(() => false);
  return { sections, goal, size, choices, any: goal || size || sections.some((section) => section.prose || section.items.some(Boolean)) };
}

/**
 * The earlier plan to mark against, only while a plan is asked again (`asking`: a scope approval is
 * open): once approved, later edits inside the scope are the owner's and the plan looks as before.
 */
export function markedAgainst<Previous>(previous: Previous | null | undefined, asking: boolean): Previous | null {
  return asking ? previous ?? null : null;
}

/**
 * The line above a plan with changes, saying what green means; `clock` is the answer's time
 * ("02:41"), `day` its day ("Today", "Yesterday", "Oct 12"), each null when unreadable.
 */
export function planChangesCaption(kind: PlanAnswerKind, clock: string | null, day: string | null = null): string {
  const what = kind === "approved" ? "you approved" : kind === "changes requested" ? "you asked to change" : "you answered";
  const on = day === null || day === "Today" ? "" : day === "Yesterday" ? " yesterday" : ` on ${day}`;
  return `Green: new or changed since the plan ${what}${on}${clock === null ? "" : ` at ${clock}`}`;
}
