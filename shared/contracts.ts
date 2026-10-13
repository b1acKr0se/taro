/**
 * Every crossing between the Taro screen and the daemon. Wire names must match
 * `/^[a-z][a-z0-9._-]*$/` (Paseo refuses camelCase).
 */
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

import { ProjectConfigSchema, ProjectNameSchema, ProjectSettingsSchema } from "./project";

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
