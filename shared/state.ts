/** Plugin-owned state that the screen also reads: stored decisions and per-agent supervision. */
import { z } from "zod";

import { ParsedDecisionSchema, StatusStateSchema } from "./reports";
import { IdleCompactionSchema } from "./idle-compaction";
import { RoleSchema } from "./project";

export const DecisionAnswerSchema = z.object({
  text: z.string(),
  /** The option pressed, or null for typed words. */
  label: z.string().nullable(),
  at: z.string(),
});

export const StoredDecisionSchema = ParsedDecisionSchema.extend({
  /** `<agentId>:<decision id>`: unique, and a later block with the same id replaces it. */
  key: z.string(),
  project: z.string(),
  ticket: z.string().nullable(),
  agentId: z.string(),
  agentRole: RoleSchema,
  agentTitle: z.string().nullable(),
  askedAt: z.string(),
  /** The turn that asked it (`turnIdentity`): the same block in another turn is asked again (TR-108). Null before it was recorded. */
  turn: z.string().nullable().default(null),
  status: z.enum(["open", "answered", "withdrawn"]),
  answer: DecisionAnswerSchema.nullable().default(null),
  /** Withdrawn because the agent that asked went away, not by the agent itself (TR-136). */
  withdrawnWithAgent: z.boolean().optional(),
  /** The owner a withdrawn question was carried to in its first message (TR-136). */
  carriedTo: z.string().optional(),
  /** Held back while another of its owner's questions was open (TR-124), so never shown; true until shown or withdrawn. */
  held: z.boolean().optional(),
  /** The user dismissed this manager question from the Needs you board (TR-234): it stays open in the chat. Asking it again clears it. */
  dismissedFromBoard: z.boolean().optional(),
  /**
   * Stored blocking by the plugin whatever its block said (TR-146): asked by an owner while its ticket
   * was planning, or still open when its owner delivered.
   */
  madeBlocking: z.boolean().optional(),
});
export type StoredDecision = z.infer<typeof StoredDecisionSchema>;

export const LastStatusSchema = z.object({ state: StatusStateSchema, text: z.string(), at: z.string() });

export const HeldReportSchema = z.object({
  fromAgentId: z.string(),
  role: z.string(),
  title: z.string(),
  ticket: z.string().nullable(),
  text: z.string(),
  turnId: z.string(),
});
export type HeldReport = z.infer<typeof HeldReportSchema>;

export const CompactionStageSchema = z.enum(["none", "handoff", "compacting", "reloading"]);
export type CompactionStage = z.infer<typeof CompactionStageSchema>;

export const AgentStateSchema = z.object({
  project: z.string(),
  role: RoleSchema,
  ticket: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  lastStatus: LastStatusSchema.nullable().default(null),
  /** A turn ended with a status line saying the work stopped without a reason; reset by any other ending. */
  stallCount: z.number().int().default(0),
  /** Set when two consecutive stalls (after the nudge) leave the card in Stalled, or crashes exhaust recovery. */
  stalled: z.boolean().default(false),
  /** Why the plugin gave up on it, when it says more than the status line does (a crash past the recovery limit). */
  stalledReason: z.string().nullable().default(null),
  /** When the plugin automatically recovered it from a crash, for the per-hour limit (TR-012). */
  recoveries: z.array(z.string()).default([]),
  deliveredTurns: z.array(z.string()).default([]),
  /** Reports from this owner's subagents, waiting until it is idle. */
  heldReports: z.array(HeldReportSchema).default([]),
  compaction: CompactionStageSchema.default("none"),
  idleCompaction: IdleCompactionSchema.default("none"),
  lastTurnEndedAt: z.string().nullable().default(null),
  /** The missing-evidence set the owner was last told about, so each distinct set is sent once. */
  evidenceReminded: z.string().nullable().default(null),
  /** Told its commits have no plan on the ticket (TR-206); cleared once the plan is there, so a later gap is told again. */
  noPlanFlagged: z.boolean().default(false),
});
export type AgentState = z.infer<typeof AgentStateSchema>;

/** Open decisions whose agent Paseo still has unarchived: answering any other would message no one. */
export function decisionsOfLiveAgents<T extends Pick<StoredDecision, "agentId" | "status">>(decisions: readonly T[], liveAgentIds: ReadonlySet<string>): T[] {
  return decisions.filter((decision) => decision.status === "open" && liveAgentIds.has(decision.agentId));
}

/**
 * Hides one open manager question from the board (TR-234); true when it was shown there. A question
 * with a ticket is an owner's, which this leaves alone, and a repeated dismissal changes nothing.
 */
export function dismissManagerQuestion(decisions: StoredDecision[], project: string, key: string): boolean {
  const decision = decisions.find((candidate) => candidate.key === key && candidate.project === project);
  if (decision === undefined || decision.status !== "open" || decision.ticket !== null || decision.dismissedFromBoard === true) return false;
  decision.dismissedFromBoard = true;
  return true;
}

/**
 * Marks the open decisions `matches` picks as withdrawn; returns how many it withdrew. `withAgent`:
 * their agent went away, so a ticket's next owner is handed them (TR-136).
 */
export function withdrawOpenDecisions(decisions: StoredDecision[], matches: (decision: StoredDecision) => boolean, withAgent = false): number {
  let withdrawn = 0;
  for (const decision of decisions) {
    if (decision.status !== "open" || !matches(decision)) continue;
    decision.status = "withdrawn";
    if (withAgent) decision.withdrawnWithAgent = true;
    withdrawn += 1;
  }
  return withdrawn;
}

/**
 * The open decision that holds back another one an agent asks (TR-124): an owner asks the user one
 * thing at a time, so its next question waits until this one is answered or withdrawn. Re-asking
 * the open decision itself (the same key) is never held.
 */
export function openQuestionHolding<T extends Pick<StoredDecision, "agentId" | "key" | "status">>(decisions: readonly T[], agentId: string, key: string): T | undefined {
  return decisions.find((decision) => decision.agentId === agentId && decision.status === "open" && decision.key !== key);
}

/** A question handed to a ticket's new owner (TR-136); `shown`: the user saw some copy of it. */
export interface CarriedQuestion<T> {
  decision: T;
  shown: boolean;
}

/**
 * The questions a ticket's new owner is handed (TR-136): owners' questions withdrawn because their
 * owner went away, and ones an owner held back to ask next (TR-124), oldest first, the newest per
 * decision id. One handed to an owner that never asked it again is handed on again, so two quick
 * replacements lose nothing.
 */
export function questionsToCarry<T extends Pick<StoredDecision, "id" | "key" | "project" | "ticket" | "agentRole" | "status" | "askedAt" | "withdrawnWithAgent" | "carriedTo" | "held">>(
  decisions: readonly T[],
  project: string,
  ticket: string,
): CarriedQuestion<T>[] {
  const ofTicket = decisions.filter((decision) => decision.project === project && decision.ticket?.toUpperCase() === ticket.toUpperCase() && decision.agentRole === "owner");
  const keys = new Set(decisions.map((decision) => decision.key));
  const newest = new Map<string, T>();
  for (const decision of ofTicket) {
    if (decision.status !== "withdrawn" || (decision.withdrawnWithAgent !== true && decision.held !== true)) continue;
    // Asked again by the owner it was handed to: that copy speaks for it.
    if (decision.carriedTo !== undefined && keys.has(`${decision.carriedTo}:${decision.id}`)) continue;
    const kept = newest.get(decision.id);
    if (kept === undefined || kept.askedAt < decision.askedAt) newest.set(decision.id, decision);
  }
  return [...newest.values()]
    .sort((left, right) => left.askedAt.localeCompare(right.askedAt))
    .map((decision) => ({ decision, shown: ofTicket.some((each) => each.id === decision.id && each.held !== true) }));
}

/** One line per carried question for the new owner's first message: its id, who asked it, then its question on one line. */
export function carriedQuestionLines(questions: readonly CarriedQuestion<Pick<StoredDecision, "id" | "question" | "agentId">>[]): string {
  return questions
    .map(({ decision, shown }) => `- \`${decision.id}\` (${shown ? "asked by" : "held back, never shown to the user, by"} ${decision.agentId}): ${decision.question.replace(/\s+/g, " ").trim()}`)
    .join("\n");
}
