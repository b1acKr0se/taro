/**
 * The owner's next step as a message: the ticket's facts read here, the page picked by the pure
 * `shared/next-step.ts`, and the step's message filled with both. Supervision sends it once when the
 * step starts; `taro next <ID>` (the `taro.ticket.next-step` RPC) prints the same text at any time.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parentTicketId } from "../shared/approval-gate";
import { deliveryGaps } from "../shared/execution";
import { lacksPlan } from "../shared/no-plan";
import { nextStep, STEP_PAGES, type Step, type StepPage, type StepTicket } from "../shared/next-step";
import { ticketEvidence } from "./evidence";
import { message, skillDirectory, TEMPLATES, withoutNotes } from "./package-files";
import { projectPaths, readProjectConfig } from "./projects";
import { listTickets, viewTicket } from "./tickets";

/** The ticket as the step picker reads it: its children, its parent's approval, and what its delivery still lacks. */
export async function stepTicket(project: string, ticket: string): Promise<StepTicket> {
  const tracker = (await projectPaths(project)).tracker;
  const detail = await viewTicket(tracker, ticket);
  const config = await readProjectConfig(project);
  const children = detail.subtasks.length === 0 ? [] : (await listTickets(tracker)).filter((each) => each.parentTaskId === detail.id);
  const parent = parentTicketId(detail.id);
  const parentNotes = parent === null ? null : await viewTicket(tracker, parent).then((parentDetail) => parentDetail.implementationNotes, () => null);
  const investigation = detail.labels.includes("investigation");
  const gaps = [...(await ticketEvidence(project, detail.id, detail.implementationNotes, detail.labels)).missing];
  if (config !== null && config !== undefined) gaps.push(...deliveryGaps(config, investigation, detail.implementationNotes, detail.finalSummary));
  if (lacksPlan({ status: detail.status, plan: detail.implementationPlan, criteria: detail.acceptanceCriteria.length, labels: [] })) {
    gaps.push("the plan: write it with `taro ticket edit --plan` (templates/plan.md); the Accept card shows it");
  }
  if ((detail.finalSummary ?? "").trim() === "") gaps.push("the FINAL summary, with the move to Awaiting acceptance (templates/final.md)");
  return {
    id: detail.id,
    status: detail.status,
    labels: detail.labels,
    notes: detail.implementationNotes,
    parentNotes,
    children: children.map((child) => ({ id: child.id, title: child.title, status: child.status, dependencies: child.dependencies })),
    baseBranch: config?.baseBranch ?? "main",
    deliveryGaps: gaps,
  };
}

const STEP_TEMPLATES: Record<StepPage, (typeof TEMPLATES)[keyof typeof TEMPLATES]> = {
  [STEP_PAGES.light]: TEMPLATES.stepLevel,
  [STEP_PAGES.medium]: TEMPLATES.stepLevel,
  [STEP_PAGES.high]: TEMPLATES.stepLevel,
  [STEP_PAGES.build]: TEMPLATES.stepBuild,
  [STEP_PAGES.review]: TEMPLATES.stepReview,
  [STEP_PAGES.delivery]: TEMPLATES.stepDelivery,
  [STEP_PAGES.accept]: TEMPLATES.stepAccept,
};

/** The step's message: its lead with the ticket's facts, then the page itself. */
export async function stepText(step: Step): Promise<string> {
  const skill = await skillDirectory();
  const page = withoutNotes(await readFile(join(skill, step.page), "utf8"));
  return message(STEP_TEMPLATES[step.page], { ...step.facts, skill, page: step.page, text: page });
}

/** The ticket's current step and its message; null when it has none. */
export async function currentStep(project: string, ticket: string): Promise<{ step: Step; text: string } | null> {
  const step = nextStep(await stepTicket(project, ticket));
  return step === null ? null : { step, text: await stepText(step) };
}

/** What `taro next` prints for a ticket with no step now. */
export function noStepText(ticket: string): string {
  return `${ticket} has no step to send now: it is not rated yet (add its complexity- label), closed, or waiting for the user's Accept.`;
}

/** The `taro.ticket.next-step` RPC's answer: the step's message, or why there is none. */
export async function nextStepAnswer(project: string, ticket: string): Promise<{ message: string; page: string | null }> {
  const step = await currentStep(project, ticket);
  return step === null ? { message: noStepText(ticket), page: null } : { message: step.text, page: step.step.page };
}
