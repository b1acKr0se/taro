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

export const ROLES = ["manager", "owner", "implementer", "reviewer", "researcher"] as const;
/** The agents an owner launches, each named by its job. */
export const SUBAGENT_ROLES = ["implementer", "reviewer", "researcher"] as const;
export type Role = (typeof ROLES)[number];
export type SubagentRole = (typeof SUBAGENT_ROLES)[number];

/** Reads a stored or labelled role; agents started before TR-017 say `helper`, which was an implementer. */
export const RoleSchema = z.preprocess((value) => (value === "helper" ? "implementer" : value), z.enum(ROLES));

/** The role a `taro.role` label value names, or null for an agent that is not Taro's. */
export function roleFromLabel(value: string | undefined): Role | null {
  const role = RoleSchema.safeParse(value);
  return role.success ? role.data : null;
}

export function isSubagentRole(role: string): role is SubagentRole {
  return (SUBAGENT_ROLES as readonly string[]).includes(role);
}

/** Taro's ticket statuses, Done last. */
export const TICKET_STATUSES = [
  "Queued",
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
/** How Accept merges a pull request (TR-110): `gh pr merge --merge`, `--rebase` or `--squash`. */
export const MergeMethodSchema = z.enum(["merge", "rebase", "squash"]);
export type MergeMethod = z.infer<typeof MergeMethodSchema>;

/** What the user chooses when adding a project (and edits later in its settings). */
export const ProjectSettingsSchema = z.object({
  repoPath: z.string().min(1),
  baseBranch: z.string().min(1),
  ticketPrefix: TicketPrefixSchema,
  manager: ModelChoiceSchema,
  owner: ModelChoiceSchema,
  /** Models an owner may give its subagents; empty means the owner's own model. */
  subagentModels: z.array(z.string().min(1)).default([]),
  delivery: DeliverySchema.default("pull-request"),
  acceptAlsoMerges: z.boolean().default(true),
  mergeMethod: MergeMethodSchema.default("merge"),
  trackerSync: TrackerSyncSchema.default("local"),
  compactThresholdTokens: z.number().int().positive().default(250_000),
  /** An owner or manager idle for about an hour above this is compacted before its prompt cache expires (TR-015). */
  idleCompactThresholdTokens: z.number().int().positive().default(200_000),
  /** Task owners running at once; the manager queues the rest (every agent costs host threads and money). */
  maxParallelOwners: z.number().int().min(1).max(20).default(3),
  /** Tell the user, on the phone and the desktop, when something enters Needs you (TR-059). */
  notify: z.boolean().default(true),
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

/** A stored `taro.json` from before TR-017 names the subagent models `helperModels`; read it under the new key. */
export function migrateStoredConfig(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !("helperModels" in raw)) return raw;
  const { helperModels, ...rest } = raw as Record<string, unknown>;
  return "subagentModels" in rest ? rest : { ...rest, subagentModels: helperModels };
}
