/**
 * Every crossing between the Taro screen and the daemon. Wire names must match
 * `/^[a-z][a-z0-9._-]*$/` (Paseo refuses camelCase).
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

import { ActivitySchema } from "./activity";
import { OutgoingAttachmentsSchema } from "./attachments";
import { ChatMessageIdSchema } from "./pending-sends";
import { ColumnIdSchema } from "./board";
import { MilestoneSchema } from "./milestones";
import { PauseViewSchema } from "./pause";
import { PermissionAskSchema } from "./permission-asks";
import { PlanAnswerKindSchema } from "./plan-changes";
import { PULL_REQUEST_STATES } from "./pull-request-state";
import { QueuedWaitSchema } from "./queued-wait";
import { PaseoProjectCandidateSchema, SettingsTemplateSchema } from "./project-candidates";
import { ProjectConfigSchema, ProjectNameSchema, ProjectSettingsSchema, ROLES, SUBAGENT_ROLES } from "./project";
import { CrashReportSchema, DeviceSchema, LaunchIdSchema, TrailReportSchema } from "./crash-trail";
import { BoardAlertSchema, HeadroomSchema } from "./recovery";
import { LastStatusSchema, StoredDecisionSchema } from "./state";

const Empty = z.object({});
const ProjectInput = z.object({ project: ProjectNameSchema });

/** A pending permission request in its own words (TR-045), who asks it and how many wait with it (TR-096). */
export const AgentAskSchema = z.object({
  title: z.string(),
  detail: z.string().nullable(),
  id: z.string().nullable().default(null),
  agentId: z.string().nullable().default(null),
  role: z.enum(ROLES).nullable().default(null),
  workspaceId: z.string().nullable().default(null),
  count: z.number().int().default(1),
});
export type AgentAskView = z.infer<typeof AgentAskSchema>;

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
  /** When its current turn started, while one runs (TR-080): what it said before is the previous turn's. */
  turnStartedAt: z.string().nullable().default(null),
  /** Whether a message sent mid-turn joins the turn rather than replace it (TR-084, `steersMidTurn`); absent, the chat judges from the provider id. */
  steers: z.boolean().optional(),
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
  /** When the manager's last turn ended, as the plugin saw it: the pane's Replace manager offer (TR-128). */
  managerLastTurnEndedAt: z.string().nullable().default(null),
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

export const PrerequisiteIdSchema = z.enum(["paseo-cli", "node", "git", "gh", "providers"]);
export type PrerequisiteId = z.infer<typeof PrerequisiteIdSchema>;

export const PrerequisiteSchema = z.object({
  id: PrerequisiteIdSchema,
  name: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});
export type Prerequisite = z.infer<typeof PrerequisiteSchema>;

export const checkPrerequisites = defineRpc({
  name: "taro.prerequisites.check",
  input: Empty,
  output: z.object({ checks: z.array(PrerequisiteSchema) }),
});

/** The merge methods the repository's GitHub settings allow (TR-110); null when gh cannot say (no gh, no GitHub remote). */
export const readMergeMethods = defineRpc({
  name: "taro.project.merge-methods",
  input: z.object({ repoPath: z.string() }),
  output: z.object({ allowed: z.object({ merge: z.boolean(), rebase: z.boolean(), squash: z.boolean() }).nullable() }),
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
/** The same manager and conversation in a new process (TR-072); `restartManager` starts a fresh one. */
export const resumeManager = defineRpc({ name: "taro.manager.resume", input: ProjectInput, output: ManagerResult });
export const compactManager = defineRpc({ name: "taro.manager.compact", input: ProjectInput, output: ManagerResult });
export const tellManager = defineRpc({
  name: "taro.manager.tell",
  // Images and files from the composer (TR-036); the words may be empty when there are some.
  input: z.object({ project: ProjectNameSchema, text: z.string(), ...OutgoingAttachmentsSchema, messageId: ChatMessageIdSchema.optional() }),
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
  /** The ticket's PR, read from its records while it is under way or Done. */
  pullRequest: z.string().nullable().default(null),
  /** Whether the owner recorded the PR as merged at Accept (TR-114); shown on Done cards. */
  pullRequestMerged: z.boolean().default(false),
  /** What GitHub last said of the PR (TR-152); null until it has answered, or with no gh. */
  pullRequestState: z.enum(PULL_REQUEST_STATES).nullable().default(null),
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
  /** The running owner's latest tool call in a few words (TR-080); null while it is idle. */
  activity: ActivitySchema.nullable().default(null),
  /** The judged evidence, set only while the ticket is Awaiting acceptance. */
  evidence: EvidenceViewSchema.nullable().default(null),
  /** Set from the ACCEPTED record while the ticket is still Awaiting acceptance: the ticket is merging (TR-031, the plugin merges since TR-141). */
  accepted: z.object({ at: z.string(), merging: z.string().nullable() }).nullable().default(null),
  /**
   * Set from a NOT-MERGED record while the ticket is Awaiting acceptance: why the owner did not merge after Accept (TR-109);
   * `merged` when a pull request merged and the local base branch could not follow it (NOT-SYNCED, TR-110).
   */
  notMerged: z.object({ at: z.string(), reason: z.string(), merged: z.boolean().default(false) }).nullable().default(null),
  /** What the first pending permission of the ticket's owner or subagents asks, in its own words (TR-045), and who asks (TR-096). */
  permission: AgentAskSchema.nullable().default(null),
  /** The delivery in a line, from the FINAL summary, while the ticket is Awaiting acceptance (TR-045). */
  delivered: z.string().nullable().default(null),
  /** Pausing, paused or queued to resume (TR-088), else null. */
  pause: PauseViewSchema.nullable().default(null),
  /** Pause is offered: a top-level ticket under way, not pausing or paused already. */
  pausable: z.boolean().default(false),
  /** What a Queued ticket waits on: dependencies not yet Done, the manager's HOLD (TR-138), else null. */
  queuedWait: QueuedWaitSchema.nullable().default(null),
});
export type Card = z.infer<typeof CardSchema>;

export const BoardSchema = z.object({
  project: z.string(),
  cards: z.array(CardSchema),
  managerDecisions: z.array(StoredDecisionSchema),
  /** Open questions live agents ask on tickets, every ticket's whether or not its card is on a page: the Inbox lists each (TR-123). */
  ticketQuestions: z.number().int().default(0),
  /** The first permission the manager or one of its own subagents (no ticket) waits on (TR-096). */
  managerPermission: AgentAskSchema.nullable().default(null),
  suggestions: z.array(SuggestionSchema),
  /** The host's thread usage, or null where it publishes no limit (TR-012). */
  headroom: HeadroomSchema.nullable(),
  alerts: z.array(BoardAlertSchema),
  loadedAt: z.string(),
  /** Each column's true ticket count: Queued and Done carry only their newest page of cards (TR-082). */
  totals: z.record(ColumnIdSchema, z.number()),
  /** Cards sent only because they were asked for by id (an open ticket past its column's page): not drawn in a column. */
  offPage: z.array(z.string()).default([]),
});
export type Board = z.infer<typeof BoardSchema>;

/** How many cards each paged column sends (the first page when left out), and tickets wanted whatever their page (TR-082). */
export const BoardPagingSchema = z.object({
  limits: z
    .object({ queued: z.number().int().min(0).max(10_000).optional(), parked: z.number().int().min(0).max(10_000).optional(), done: z.number().int().min(0).max(10_000).optional() })
    .optional(),
  include: z.array(z.string()).max(20).optional(),
});
export type BoardPaging = z.infer<typeof BoardPagingSchema>;

export const loadBoard = defineRpc({ name: "taro.board.load", input: ProjectInput.extend(BoardPagingSchema.shape), output: BoardSchema });

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
  /** Pausing, paused or queued to resume (TR-088), else null. */
  pause: PauseViewSchema.nullable().default(null),
  pausable: z.boolean().default(false),
  /** The owner's agent id while Compact is offered for it (`shared/compact.ts`, TR-095), else null. */
  compactOwner: z.string().nullable().default(null),
  /** Change spec… is offered: Queued with no owner (`shared/spec-change.ts`, TR-129). */
  specChangeable: z.boolean().default(false),
  /** The plan the user last answered, when and how (TR-151), so a plan asked again marks what changed since; null before any answer. */
  previousPlan: z.object({ plan: z.string(), at: z.string(), kind: PlanAnswerKindSchema }).nullable().default(null),
  /** The owner is in a turn here (TR-153): a delivered ticket's Accept waits until it ends. */
  ownerRunning: z.boolean().default(false),
});
export type TicketDetailView = z.infer<typeof TicketDetailSchema>;

export const loadTicket = defineRpc({
  name: "taro.ticket.load",
  input: z.object({ project: ProjectNameSchema, ticket: z.string() }),
  output: TicketDetailSchema,
});

/** A finished plan card's plan (TR-157), as it stood when the user answered it or, unanswered, when it was asked; null when the tracker's history does not reach it. */
export const loadPastPlan = defineRpc({
  name: "taro.ticket.past-plan",
  input: z.object({ project: ProjectNameSchema, ticket: z.string(), answeredAt: z.string().nullable(), askedAt: z.string().nullable() }),
  output: z.object({ plan: z.string().nullable() }),
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

/** Every decision Taro still holds for one agent, any status, for the finished cards in its chat (TR-149). */
export const listAgentDecisions = defineRpc({
  name: "taro.decisions.agent",
  input: z.object({ agentId: z.string() }),
  output: z.object({ decisions: z.array(StoredDecisionSchema) }),
});

/** One agent's answered permission asks, oldest first, for the finished cards in its chat (TR-149). */
export const answeredPermissionAsks = defineRpc({
  name: "taro.permissions.answered",
  input: z.object({ agentId: z.string() }),
  output: z.object({ asks: z.array(PermissionAskSchema) }),
});

const AgentInput = z.object({ agentId: z.string() });

export const tellAgent = defineRpc({
  name: "taro.agent.tell",
  // `messageId`: the chat's id for the message, to mark it until the agent takes it up (TR-084).
  input: z.object({ agentId: z.string(), text: z.string(), ...OutgoingAttachmentsSchema, messageId: ChatMessageIdSchema.optional() }),
  output: Empty,
});
export const nudgeAgent = defineRpc({ name: "taro.agent.nudge", input: AgentInput, output: Empty });
export const compactAgent = defineRpc({ name: "taro.agent.compact", input: AgentInput, output: Empty });
export const relaunchOwner = defineRpc({
  name: "taro.owner.relaunch",
  input: z.object({ project: ProjectNameSchema, ticket: z.string() }),
  output: z.object({ agentId: z.string() }),
});
/** Pause and Resume (TR-088): `message` is what the user is told; `agentId` the fresh owner Resume started, if any. */
export const pauseTicket = defineRpc({ name: "taro.ticket.pause", input: z.object({ project: ProjectNameSchema, ticket: z.string() }), output: z.object({ message: z.string() }) });
export const resumeTicket = defineRpc({
  name: "taro.ticket.resume",
  input: z.object({ project: ProjectNameSchema, ticket: z.string() }),
  output: z.object({ message: z.string(), agentId: z.string().nullable() }),
});
export const acceptTicket = defineRpc({ name: "taro.ticket.accept", input: z.object({ project: ProjectNameSchema, ticket: z.string() }), output: Empty });
export const resolveTrackerSync = defineRpc({
  name: "taro.tracker.resolve-sync",
  input: z.object({ project: ProjectNameSchema, resolution: SyncResolutionSchema }),
  output: z.object({ problem: TrackerSyncProblemSchema.nullable() }),
});
/**
 * Dismisses the queued-with-a-free-slot alert for the tickets it showed, which also stops the manager's
 * restart for them (TR-062); a ticket that joined since keeps it up (TR-064).
 */
export const dismissQueueAlert = defineRpc({
  name: "taro.queue.dismiss-alert",
  input: z.object({ project: ProjectNameSchema, tickets: z.array(z.string()).min(1) }),
  output: Empty,
});
export const requestChanges = defineRpc({
  name: "taro.ticket.request-changes",
  input: z.object({ project: ProjectNameSchema, ticket: z.string(), text: z.string().min(1) }),
  output: Empty,
});
/** Change spec… on a Queued ticket with no owner (TR-129): the user's words go to the manager, tagged with the ticket. */
export const changeQueuedSpec = defineRpc({
  name: "taro.ticket.change-spec",
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
  startedAt: z.number().nullable().default(null),
  finishedAt: z.number().nullable().default(null),
  byStatus: z.record(z.string(), z.number()),
  waitingOnUserMs: z.number(),
  agentActiveMs: z.number(),
  turns: z.number(),
  agents: z.number(),
  costUsd: z.number().nullable(),
  agentsWithoutCost: z.number(),
  nudges: z.number(),
  decisions: z.number(),
  recoveries: z.number(),
  idleCompactions: z.number(),
  permissionDenials: z.number(),
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
  // The size in pixels from the file's header, so the phone need not decode the image to learn its shape (TR-164); absent when unreadable.
  output: z.object({ image: z.object({ mimeType: z.string(), data: z.string(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() }).nullable() }),
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

export const FeedNotificationSchema = z.object({
  seq: z.number().int(),
  title: z.string(),
  body: z.string(),
  /** Paseo's notification routing fields (`serverId`, `agentId`, `workspaceId`): a click opens the agent. */
  data: z.record(z.string(), z.string()),
});
export type FeedNotification = z.infer<typeof FeedNotificationSchema>;

/**
 * A window collects what entered Needs you since `after` (TR-059); `after` below zero starts from now.
 * `active`: it can show a desktop notification and was used in the last three minutes, so the phone
 * is not pushed as well.
 */
export const pollNotifications = defineRpc({
  name: "taro.notifications.poll",
  input: z.object({ clientId: z.string().min(1), active: z.boolean(), after: z.number().int() }),
  output: z.object({ seq: z.number().int(), notifications: z.array(FeedNotificationSchema) }),
});

/** Crash tracing (TR-132): a launch's new steps and errors, the last crash of an earlier launch on this device, and its dismissal. */
export const reportTrail = defineRpc({ name: "taro.crash.report", input: TrailReportSchema, output: Empty });
export const loadLastCrash = defineRpc({
  name: "taro.crash.last",
  input: z.object({ launch: LaunchIdSchema, device: DeviceSchema }),
  output: z.object({ crash: CrashReportSchema.nullable() }),
});
export const dismissCrash = defineRpc({ name: "taro.crash.dismiss", input: z.object({ launch: LaunchIdSchema }), output: Empty });
