/**
 * A project's configuration (`taro.json` in its manager's home) and the
 * vocabulary every part of Taro shares: labels, statuses, roles.
 */
import { z } from "zod";

/** The labels Taro puts on every agent it or its agents start; the board finds agents by them. */
export const TARO_LABELS = {
  project: "taro.project",
  role: "taro.role",
  ticket: "taro.ticket",
} as const;

export const ROLES = ["manager", "owner", "helper", "reviewer"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

/** Taro's Backlog.md statuses, Done last (Backlog treats the last as terminal). */
export const TICKET_STATUSES = [
  "Backlog",
  "Planning",
  "Ready",
  "In Progress",
  "Reviewing",
  "Awaiting acceptance",
  "Blocked",
  "Cancelled",
  "Done",
] as const;
export const TicketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const ProjectNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use lowercase letters, digits and dashes (at most 40).");

export const TicketPrefixSchema = z
  .string()
  .regex(/^[A-Z]{1,8}$/, "Use one to eight capital letters.");

export const ModelChoiceSchema = z.object({
  /** `provider/model`, as Paseo's create call takes it. */
  model: z.string().min(1),
  /** A thinking option id the model offers; empty means the provider's default. */
  thinking: z.string().default(""),
});
export type ModelChoice = z.infer<typeof ModelChoiceSchema>;

export const DeliverySchema = z.enum(["pull-request", "local-only"]);
export const TrackerSyncSchema = z.enum(["local", "remote"]);

/** What the user chooses when adding a project (and edits later in its settings). */
export const ProjectSettingsSchema = z.object({
  repoPath: z.string().min(1),
  baseBranch: z.string().min(1),
  ticketPrefix: TicketPrefixSchema,
  manager: ModelChoiceSchema,
  owner: ModelChoiceSchema,
  helperModels: z.array(z.string().min(1)).default([]),
  delivery: DeliverySchema.default("pull-request"),
  acceptAlsoMerges: z.boolean().default(true),
  trackerSync: TrackerSyncSchema.default("local"),
  compactThresholdTokens: z.number().int().positive().default(250_000),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** `taro.json`: the settings plus what the daemon records about the project. */
export const ProjectConfigSchema = ProjectSettingsSchema.extend({
  schemaVersion: z.literal(1),
  project: ProjectNameSchema,
  /** The real repository's Paseo project, where task owners' worktrees go. */
  paseoProjectId: z.string().min(1),
  managerAgentId: z.string().default(""),
  managerWorkspaceId: z.string().default(""),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
