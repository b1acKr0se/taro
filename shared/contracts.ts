/**
 * Every crossing between the Taro screen and the daemon. Wire names must match
 * `/^[a-z][a-z0-9._-]*$/` (Paseo refuses camelCase).
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

import { ColumnIdSchema } from "./board";
import { ProjectConfigSchema, ProjectNameSchema, ProjectSettingsSchema } from "./project";
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
});
export type AgentBrief = z.infer<typeof AgentBriefSchema>;

export const ProjectSummarySchema = z.object({
  config: ProjectConfigSchema,
  manager: AgentBriefSchema.nullable(),
  trackerSyncProblem: z.string().nullable(),
  /** Cards in Needs you or Stalled, for the sidebar badge and tabs. */
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
  input: z.object({ project: ProjectNameSchema, text: z.string() }),
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
  lastStatus: LastStatusSchema.nullable(),
  stalled: z.boolean(),
  decisions: z.array(StoredDecisionSchema),
  helpers: z.array(AgentBriefSchema),
});
export type Card = z.infer<typeof CardSchema>;

export const BoardSchema = z.object({
  project: z.string(),
  cards: z.array(CardSchema),
  managerDecisions: z.array(StoredDecisionSchema),
  suggestions: z.array(SuggestionSchema),
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
  input: z.object({ key: z.string(), label: z.string().nullable(), text: z.string() }),
  output: Empty,
});

export const listOpenDecisions = defineRpc({
  name: "taro.decisions.open",
  input: z.object({ project: ProjectNameSchema.nullable() }),
  output: z.object({ decisions: z.array(StoredDecisionSchema) }),
});

const AgentInput = z.object({ agentId: z.string() });

export const tellAgent = defineRpc({ name: "taro.agent.tell", input: z.object({ agentId: z.string(), text: z.string() }), output: Empty });
export const nudgeAgent = defineRpc({ name: "taro.agent.nudge", input: AgentInput, output: Empty });
export const compactAgent = defineRpc({ name: "taro.agent.compact", input: AgentInput, output: Empty });
export const relaunchOwner = defineRpc({
  name: "taro.owner.relaunch",
  input: z.object({ project: ProjectNameSchema, ticket: z.string() }),
  output: z.object({ agentId: z.string() }),
});
export const acceptTicket = defineRpc({ name: "taro.ticket.accept", input: z.object({ project: ProjectNameSchema, ticket: z.string() }), output: Empty });
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
