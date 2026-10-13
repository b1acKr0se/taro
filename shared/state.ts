/** Plugin-owned state that the screen also reads: stored decisions and per-agent supervision. */
import { z } from "zod";

import { ParsedDecisionSchema, StatusStateSchema } from "./reports";
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
  status: z.enum(["open", "answered", "withdrawn"]),
  answer: DecisionAnswerSchema.nullable().default(null),
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
  /** Set when two consecutive stalls (after the nudge) leave the card in Stalled. */
  stalled: z.boolean().default(false),
  deliveredTurns: z.array(z.string()).default([]),
  /** Reports from this owner's helpers, waiting until it is idle. */
  heldReports: z.array(HeldReportSchema).default([]),
  compaction: CompactionStageSchema.default("none"),
  lastTurnEndedAt: z.string().nullable().default(null),
});
export type AgentState = z.infer<typeof AgentStateSchema>;
