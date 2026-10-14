/**
 * Every crossing between the Taro screen and the daemon. Wire names must match
 * `/^[a-z][a-z0-9._-]*$/` (Paseo refuses camelCase).
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

import { OutgoingAttachmentsSchema } from "./attachments";
import { ColumnIdSchema } from "./board";
import { MilestoneSchema } from "./milestones";
import { PaseoProjectCandidateSchema, SettingsTemplateSchema } from "./project-candidates";
import { ProjectConfigSchema, ProjectNameSchema, ProjectSettingsSchema, SUBAGENT_ROLES } from "./project";
import { BoardAlertSchema, HeadroomSchema } from "./recovery";
import { LastStatusSchema, StoredDecisionSchema } from "./state";

const Empty = z.object({});
const ProjectInput = z.object({ project: ProjectNameSchema });

export const AgentBriefSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  workspaceId: z.string().nullable(),
  pendingPermissions: z.number().int(),
  updatedAt: z.string(),
  contextUsedTokens: z.number().nullable(),
  contextMaxTokens: z.number().nullable(),
  /** When Paseo created it: a subagent's running time on the card and in the owner pane. */
  createdAt: z.string().nullable().default(null),
});
export type AgentBrief = z.infer<typeof AgentBriefSchema>;

/** Why ticket sync with the remote is paused (decision 31): a conflict on tickets, or git failing outright. */
export const TrackerSyncProblemSchema = z.object({
  kind: z.enum(["conflict", "failed"]),
  message: z.string(),
  /** Tickets changed both here and on the remote. */
  tickets: z.array(z.string()),
});
export type TrackerSyncProblem = z.infer<typeof TrackerSyncProblemSchema>;

export const SyncResolutionSchema = z.enum(["keep-local", "keep-remote", "retry"]);
export type SyncResolution = z.infer<typeof SyncResolutionSchema>;

export const ProjectSummarySchema = z.object({
  config: ProjectConfigSchema,
  manager: AgentBriefSchema.nullable(),
  trackerSyncProblem: TrackerSyncProblemSchema.nullable(),
  /** Cards in Needs you or Stalled, plus a paused ticket sync, for the sidebar badge and tabs. */
  needsYou: z.number().int(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const listProjects = defineRpc({
  name: "taro.projects.list",
  input: Empty,
  output: z.object({ taroHome: z.string(), projects: z.array(ProjectSummarySchema) }),
});

export const PrerequisiteSchema = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });

export const checkPrerequisites = defineRpc({
  name: "taro.prerequisites.check",
  input: Empty,
  output: z.object({ checks: z.array(PrerequisiteSchema) }),
});

export const onboardProject = defineRpc({
  name: "taro.project.onboard",
  input: z.object({ project: ProjectNameSchema, settings: ProjectSettingsSchema, startManager: z.boolean().default(true) }),
  output: z.object({ config: ProjectConfigSchema, managerAgentId: z.string().nullable() }),
});

/** Before adding a project: what would fail, by field, so the form shows it beside the field (TR-056). */
export const checkOnboarding = defineRpc({
  name: "taro.project.onboard.check",
  input: z.object({ project: z.string(), settings: ProjectSettingsSchema }),
  output: z.object({
    problems: z.object({ project: z.string().optional(), repoPath: z.string().optional(), ticketPrefix: z.string().optional(), baseBranch: z.string().optional() }),
  }),
});

/** Paseo's git projects for the New project picker, and the settings a new project starts from (TR-056). */
export const listPaseoProjects = defineRpc({
  name: "taro.paseo-projects.list",
  input: Empty,
  output: z.object({ projects: z.array(PaseoProjectCandidateSchema), template: SettingsTemplateSchema.nullable(), takenPrefixes: z.array(z.string()) }),
});

export const readProjectConfig = defineRpc({
  name: "taro.project.config.read",
  input: ProjectInput,
  output: z.object({ config: ProjectConfigSchema }),
});

export const writeProjectSettings = defineRpc({
  name: "taro.project.config.write",
  input: z.object({ project: ProjectNameSchema, settings: ProjectSettingsSchema }),
  output: z.object({ config: ProjectConfigSchema }),
});

export const readStandingOrders = defineRpc({
  name: "taro.project.orders.read",
  input: ProjectInput,
  output: z.object({ text: z.string() }),
});

export const writeStandingOrders = defineRpc({
  name: "taro.project.orders.write",
  input: z.object({ project: ProjectNameSchema, text: z.string() }),
  output: Empty,
});

const ManagerResult = z.object({ agentId: z.string() });

export const launchManager = defineRpc({ name: "taro.manager.launch", input: ProjectInput, output: ManagerResult });
export const restartManager = defineRpc({ name: "taro.manager.restart", input: ProjectInput, output: ManagerResult });
export const compactManager = defineRpc({ name: "taro.manager.compact", input: ProjectInput, output: ManagerResult });
export const tellManager = defineRpc({
  name: "taro.manager.tell",
  // Images and files from the composer (TR-036); the words may be empty when there are some.
  input: z.object({ project: ProjectNameSchema, text: z.string(), ...OutgoingAttachmentsSchema }),
  output: ManagerResult,
});
export const catchUp = defineRpc({ name: "taro.manager.catch-up", input: ProjectInput, output: ManagerResult });

export const listModels = defineRpc({
  name: "taro.models.list",
  input: Empty,
  output: z.object({
    models: z.array(z.object({ id: z.string(), label: z.string(), thinkingOptions: z.array(z.string()), defaultThinking: z.string() })),
  }),
});

// ── Phase 2: board, tickets, decisions, owners ──────────────────────────────


export const SuggestionSchema = z.object({ label: z.string(), prompt: z.string() });

/** The judged EVIDENCE record (shared/evidence.ts) with each screenshot's absolute path on the daemon. */
export const EvidenceViewSchema = z.object({
  checks: z.array(z.object({ command: z.string(), result: z.string() })),
  review: z.string().nullable(),
  ux: z.string().nullable().default(null),
  screenshots: z.array(z.object({ file: z.string(), caption: z.string(), present: z.boolean(), path: z.string() })),
  screenshotsNone: z.string().nullable(),
  missing: z.array(z.string()),
  complete: z.boolean(),
});
export type EvidenceView = z.infer<typeof EvidenceViewSchema>;

export const CardSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  column: ColumnIdSchema,
  labels: z.array(z.string()),
  complexity: z.string().nullable(),
  investigation: z.boolean(),
  parent: z.string().nullable(),
  children: z.array(z.object({ id: z.string(), title: z.string(), status: z.string() })),
  acceptanceDone: z.number(),
  acceptanceTotal: z.number(),
  updatedAt: z.string().nullable(),
  owner: AgentBriefSchema.nullable(),
  ownerElsewhere: z.string().nullable(),
  /** The ticket's PR, read from its records while it is Reviewing or Awaiting acceptance. */
  pullRequest: z.string().nullable().default(null),
  lastStatus: LastStatusSchema.nullable(),
  stalled: z.boolean(),
  /** Why the plugin left it stalled, when the status line does not say (a crash past the recovery limit). */
  stalledReason: z.string().nullable(),
  decisions: z.array(StoredDecisionSchema),
  /** The ticket's live subagents, with the job their `taro.role` label names. */
  /** The ticket's live subagents, each with its job. */
  subagents: z.array(AgentBriefSchema.extend({ role: z.enum(SUBAGENT_ROLES) })),
  /** The ticket's archived owner and subagents, newest first (a finished ticket keeps its history). */
  pastAgents: z.array(AgentBriefSchema.extend({ role: z.enum(["owner", ...SUBAGENT_ROLES]), archivedAt: z.string() })).default([]),
  /** The newest MILESTONE record, read for tickets that are under way. */
  latestMilestone: MilestoneSchema.nullable().default(null),
  /** The judged evidence, set only while the ticket is Awaiting acceptance. */
  evidence: EvidenceViewSchema.nullable().default(null),
  /** Set from the ACCEPTED record while the ticket is still Awaiting acceptance: the owner is merging (TR-031). */
  accepted: z.object({ at: z.string(), merging: z.string().nullable() }).nullable().default(null),
  /** What the owner's first pending permission asks, in its own words (TR-045). */
  permission: z.object({ title: z.string(), detail: z.string().nullable() }).nullable().default(null),
  /** The delivery in a line, from the FINAL summary, while the ticket is Awaiting acceptance (TR-045). */
  delivered: z.string().nullable().default(null),
});
export type Card = z.infer<typeof CardSchema>;

export const BoardSchema = z.object({
  project: z.string(),
  cards: z.array(CardSchema),
  managerDecisions: z.array(StoredDecisionSchema),
  suggestions: z.array(SuggestionSchema),
  /** The host's thread usage, or null where it publishes no limit (TR-012). */
  headroom: HeadroomSchema.nullable(),
  alerts: z.array(BoardAlertSchema),
  loadedAt: z.string(),
});
export type Board = z.infer<typeof BoardSchema>;

export const loadBoard = defineRpc({ name: "taro.board.load", input: ProjectInput, output: BoardSchema });

export const TicketDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  labels: z.array(z.string()),
  description: z.string().nullable(),
  acceptanceCriteria: z.array(z.object({ index: z.number(), text: z.string(), checked: z.boolean() })),
  plan: z.string().nullable(),
  notes: z.string().nullable(),
  finalSummary: z.string().nullable(),
  dependencies: z.array(z.string()),
  children: z.array(z.object({ id: z.string(), title: z.string(), status: z.string().nullable() })),
  /** The judged evidence, when the notes hold an EVIDENCE record or the ticket is Awaiting acceptance. */
  evidence: EvidenceViewSchema.nullable().default(null),
});
export type TicketDetailView = z.infer<typeof TicketDetailSchema>;

export const loadTicket = defineRpc({
  name: "taro.ticket.load",
  input: z.object({ project: ProjectNameSchema, ticket: z.string() }),
  output: TicketDetailSchema,
});

/** The project (and ticket) an agent belongs to, for the panel beside an agent tab. */
export const findAgentTicket = defineRpc({
  name: "taro.agent.find",
  input: z.object({ agentId: z.string() }),
  output: z.object({ project: z.string().nullable(), ticket: z.string().nullable(), role: z.string().nullable() }),
});

export const answerDecision = defineRpc({
  name: "taro.decision.answer",
  /** `from` names where the user answered, for the ANSWER record. */
  input: z.object({ key: z.string(), label: z.string().nullable(), text: z.string(), from: z.enum(["screen", "tab"]).default("screen") }),
  output: Empty,
});

/** One agent's stored decision by its block id, for the card inside that agent's own tab. */
export const getDecision = defineRpc({
  name: "taro.decision.get",
  input: z.object({ agentId: z.string(), id: z.string() }),
  output: z.object({ decision: StoredDecisionSchema.nullable(), agentLive: z.boolean() }),
});

export const listOpenDecisions = defineRpc({
  name: "taro.decisions.open",
  input: z.object({ project: ProjectNameSchema.nullable() }),
  output: z.object({ decisions: z.array(StoredDecisionSchema) }),
});

const AgentInput = z.object({ agentId: z.string() });

export const tellAgent = defineRpc({ name: "taro.agent.tell", input: z.object({ agentId: z.string(), text: z.string(), ...OutgoingAttachmentsSchema }), output: Empty });
export const nudgeAgent = defineRpc({ name: "taro.agent.nudge", input: AgentInput, output: Empty });
export const compactAgent = defineRpc({ name: "taro.agent.compact", input: AgentInput, output: Empty });
export const relaunchOwner = defineRpc({
  name: "taro.owner.relaunch",
  input: z.object({ project: ProjectNameSchema, ticket: z.string() }),
  output: z.object({ agentId: z.string() }),
});
export const acceptTicket = defineRpc({ name: "taro.ticket.accept", input: z.object({ project: ProjectNameSchema, ticket: z.string() }), output: Empty });
export const resolveTrackerSync = defineRpc({
  name: "taro.tracker.resolve-sync",
  input: z.object({ project: ProjectNameSchema, resolution: SyncResolutionSchema }),
  output: z.object({ problem: TrackerSyncProblemSchema.nullable() }),
});
/** Dismisses the board alert for what the tracker guard restored (TR-051). */
export const dismissTrackerProtection = defineRpc({ name: "taro.tracker.dismiss-protection", input: ProjectInput, output: Empty });
export const requestChanges = defineRpc({
  name: "taro.ticket.request-changes",
  input: z.object({ project: ProjectNameSchema, ticket: z.string(), text: z.string().min(1) }),
  output: Empty,
});
export const dismissSuggestion = defineRpc({
  name: "taro.suggestions.dismiss",
  input: z.object({ project: ProjectNameSchema, label: z.string(), prompt: z.string() }),
  output: Empty,
});

// ── Stats ───────────────────────────────────────────────────────────────────

export const StatsSummarySchema = z.object({
  project: z.string(),
  ticket: z.string(),
  title: z.string(),
  status: z.string(),
  wallMs: z.number(),
  byStatus: z.record(z.string(), z.number()),
  waitingOnUserMs: z.number(),
  agentActiveMs: z.number(),
  turns: z.number(),
  agents: z.number(),
  costUsd: z.number().nullable(),
  nudges: z.number(),
  decisions: z.number(),
  recoveries: z.number(),
  idleCompactions: z.number(),
});
export type StatsSummary = z.infer<typeof StatsSummarySchema>;

export const loadStats = defineRpc({
  name: "taro.stats.load",
  input: z.object({ project: ProjectNameSchema.nullable() }),
  /** `managerIdleCompactions`: counted per project, since the manager has no ticket. */
  output: z.object({ tickets: z.array(StatsSummarySchema), managerIdleCompactions: z.number() }),
});

/** An image Taro shows (evidence, a sent image, one an agent read), base64; null when it may not be served. */
export const readImageRpc = defineRpc({
  name: "taro.image.read",
  input: z.object({ path: z.string() }),
  output: z.object({ image: z.object({ mimeType: z.string(), data: z.string() }).nullable() }),
});

export const SentImagesMessageSchema = z.object({
  /** The message's words as Paseo's timeline has them. */
  text: z.string(),
  images: z.array(z.object({ path: z.string(), mimeType: z.string() })),
});
export type SentImagesMessage = z.infer<typeof SentImagesMessageSchema>;

/**
 * The user's messages to an agent that carried images, in order (Claude agents only), with every other
 * message of the same words (`images: []`), so the chat can count repeats.
 */
export const listSentImages = defineRpc({
  name: "taro.agent.sent-images",
  input: z.object({ agentId: z.string() }),
  output: z.object({ messages: z.array(SentImagesMessageSchema) }),
});
