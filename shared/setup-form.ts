/**
 * The add-project and project-settings form's state, apart from the page that draws it: the draft
 * the fields edit, the settings it saves, and the checks shown under each field (TR-019).
 */
import { ProjectNameSchema, TicketPrefixSchema, type ProjectConfig, type ProjectSettings } from "./project";

export interface SetupDraft {
  project: string;
  repoPath: string;
  baseBranch: string;
  ticketPrefix: string;
  managerModel: string;
  managerThinking: string;
  ownerModel: string;
  ownerThinking: string;
  subagentModels: string[];
  delivery: "pull-request" | "local-only";
  acceptAlsoMerges: boolean;
  trackerSync: "local" | "remote";
  compactThresholdTokens: string;
  idleCompactThresholdTokens: string;
  maxParallelOwners: string;
}

export const DEFAULT_COMPACT_TOKENS = 250_000;
export const DEFAULT_IDLE_COMPACT_TOKENS = 200_000;
export const DEFAULT_PARALLEL_OWNERS = 3;
export const MAX_PARALLEL_OWNERS = 20;

/** A new project's model fields start empty and take the default once the model list arrives. */
export function draftFrom(config: ProjectConfig | null): SetupDraft {
  return {
    project: config?.project ?? "",
    repoPath: config?.repoPath ?? "",
    baseBranch: config?.baseBranch ?? "main",
    ticketPrefix: config?.ticketPrefix ?? "",
    managerModel: config?.manager.model ?? "",
    managerThinking: config?.manager.thinking ?? "",
    ownerModel: config?.owner.model ?? "",
    ownerThinking: config?.owner.thinking ?? "",
    subagentModels: config?.subagentModels ?? [],
    delivery: config?.delivery ?? "pull-request",
    acceptAlsoMerges: config?.acceptAlsoMerges ?? true,
    trackerSync: config?.trackerSync ?? "local",
    compactThresholdTokens: String(config?.compactThresholdTokens ?? DEFAULT_COMPACT_TOKENS),
    idleCompactThresholdTokens: String(config?.idleCompactThresholdTokens ?? DEFAULT_IDLE_COMPACT_TOKENS),
    maxParallelOwners: String(config?.maxParallelOwners ?? DEFAULT_PARALLEL_OWNERS),
  };
}

/** A whole positive number written with optional thousands separators ("250,000", "250 000"), or null. */
export function parseCount(text: string): number | null {
  const digits = text.trim().replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number.parseInt(digits, 10);
  return value > 0 && Number.isSafeInteger(value) ? value : null;
}

export function settingsFrom(draft: SetupDraft, defaultModel: string): ProjectSettings {
  return {
    repoPath: draft.repoPath.trim(),
    baseBranch: draft.baseBranch.trim(),
    ticketPrefix: draft.ticketPrefix.trim().toUpperCase(),
    manager: { model: draft.managerModel || defaultModel, thinking: draft.managerThinking },
    owner: { model: draft.ownerModel || defaultModel, thinking: draft.ownerThinking },
    subagentModels: draft.subagentModels,
    delivery: draft.delivery,
    acceptAlsoMerges: draft.acceptAlsoMerges,
    trackerSync: draft.trackerSync,
    compactThresholdTokens: parseCount(draft.compactThresholdTokens) ?? DEFAULT_COMPACT_TOKENS,
    idleCompactThresholdTokens: parseCount(draft.idleCompactThresholdTokens) ?? DEFAULT_IDLE_COMPACT_TOKENS,
    maxParallelOwners: Math.min(MAX_PARALLEL_OWNERS, parseCount(draft.maxParallelOwners) ?? DEFAULT_PARALLEL_OWNERS),
  };
}

/** The message under each field that is wrong; a field that is fine has no key. */
export type SetupProblems = Partial<Record<keyof SetupDraft, string>>;

/**
 * What stops the form from saving. Name, repository and prefix are fixed once a project exists,
 * so only a new project checks them. An empty field the user has not typed in is still a problem:
 * the primary button stays off until it is filled.
 */
export function setupProblems(draft: SetupDraft, isNew: boolean): SetupProblems {
  const problems: SetupProblems = {};
  if (isNew) {
    const name = draft.project.trim();
    if (name === "") problems.project = "Give the project a name.";
    else {
      const parsed = ProjectNameSchema.safeParse(name);
      if (!parsed.success) problems.project = parsed.error.issues[0]?.message ?? "Not a valid name.";
    }
    const repoPath = draft.repoPath.trim();
    if (repoPath === "") problems.repoPath = "Enter the path of a local git checkout.";
    else if (!repoPath.startsWith("/")) problems.repoPath = "Use an absolute path, starting with /.";
    const prefix = draft.ticketPrefix.trim().toUpperCase();
    if (prefix === "") problems.ticketPrefix = "Choose a ticket prefix.";
    else {
      const parsed = TicketPrefixSchema.safeParse(prefix);
      if (!parsed.success) problems.ticketPrefix = parsed.error.issues[0]?.message ?? "Not a valid prefix.";
    }
  }
  if (draft.baseBranch.trim() === "") problems.baseBranch = "Name the branch work starts from.";
  if (parseCount(draft.compactThresholdTokens) === null) problems.compactThresholdTokens = "Use a whole number above zero.";
  if (parseCount(draft.idleCompactThresholdTokens) === null) problems.idleCompactThresholdTokens = "Use a whole number above zero.";
  const owners = parseCount(draft.maxParallelOwners);
  if (owners === null || owners > MAX_PARALLEL_OWNERS) problems.maxParallelOwners = `Use a whole number from 1 to ${MAX_PARALLEL_OWNERS}.`;
  return problems;
}

/** "Tickets look like AB-001": the first ticket id a prefix gives, or null while the prefix is unusable. */
export function ticketExample(prefix: string): string | null {
  const upper = prefix.trim().toUpperCase();
  return TicketPrefixSchema.safeParse(upper).success ? `${upper}-001` : null;
}
