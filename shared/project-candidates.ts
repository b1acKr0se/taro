/**
 * Adding a project from Paseo's own projects (TR-056): what the picker shows for each one and the
 * draft that picking it fills in. Pure, so the list order, the suggestions and the defaults are tested.
 */
import { z } from "zod";

import { DeliverySchema, ModelChoiceSchema, ProjectNameSchema, TicketPrefixSchema, TrackerSyncSchema } from "./project";
import { draftFrom, type SetupDraft } from "./setup-form";

export const PaseoProjectCandidateSchema = z.object({
  paseoProjectId: z.string(),
  /** The name Paseo shows (the user's custom name when set). */
  name: z.string(),
  repoPath: z.string(),
  /** The remote's address as git has it, or null when the repository has none. */
  remoteUrl: z.string().nullable(),
  /** The branch the remote's HEAD names, else the checked-out branch, else main. */
  defaultBranch: z.string(),
  /** When one of the project's workspaces was last active, ISO; null when none ever was. */
  lastActiveAt: z.string().nullable(),
  /** The Taro project this repository already is, or null. */
  taroProject: z.string().nullable(),
});
export type PaseoProjectCandidate = z.infer<typeof PaseoProjectCandidateSchema>;

/** The settings a new project copies from the last project added or edited; none before the first. */
export const SettingsTemplateSchema = z.object({
  project: z.string(),
  manager: ModelChoiceSchema,
  owner: ModelChoiceSchema,
  subagentModels: z.array(z.string()),
  delivery: DeliverySchema,
  acceptAlsoMerges: z.boolean(),
  trackerSync: TrackerSyncSchema,
  compactThresholdTokens: z.number().int().positive(),
  idleCompactThresholdTokens: z.number().int().positive(),
  maxParallelOwners: z.number().int().positive(),
});
export type SettingsTemplate = z.infer<typeof SettingsTemplateSchema>;

const MAX_NAME_LENGTH = 40;

/** A Taro project name for a Paseo project's name: lowercase, dashes for anything else. */
export function suggestProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/, "");
  return ProjectNameSchema.safeParse(slug).success ? slug : "project";
}

const VOWELS = new Set(["A", "E", "I", "O", "U", "Y"]);

/**
 * A ticket prefix for a project name, avoiding the ones other Taro projects use: the words'
 * initials ("billing-api" → BA), or for one word its first letter and next consonant ("shop" → SH,
 * "taro" → TR). Taken ones grow by a letter, then take a number-free fallback from the name.
 */
export function suggestTicketPrefix(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((prefix) => prefix.toUpperCase()));
  const words = name
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((word) => word !== "");
  if (words.length === 0) return firstFree(["PR", "PRJ", "PROJ"], used) ?? "PROJ";
  const letters = words.join("");
  const candidates: string[] = [];
  if (words.length > 1) {
    const initials = words.map((word) => word[0]).join("").slice(0, 8);
    candidates.push(initials, `${initials}${words[words.length - 1]?.[1] ?? ""}`);
  } else {
    const consonants = [...letters.slice(1)].filter((letter) => !VOWELS.has(letter));
    if (consonants[0] !== undefined) candidates.push(`${letters[0]}${consonants[0]}`);
    candidates.push(letters.slice(0, 2));
    if (consonants[1] !== undefined) candidates.push(`${letters[0]}${consonants[0]}${consonants[1]}`);
  }
  for (let length = 3; length <= Math.min(8, letters.length); length += 1) candidates.push(letters.slice(0, length));
  const valid = candidates.filter((candidate) => TicketPrefixSchema.safeParse(candidate).success);
  return firstFree(valid, used) ?? valid[0] ?? "PROJ";
}

function firstFree(candidates: readonly string[], used: ReadonlySet<string>): string | null {
  return candidates.find((candidate) => !used.has(candidate)) ?? null;
}

/** "github.com/acme/shop" for the remote addresses git takes (scp-like, ssh://, https:// with a user), else the address as is. */
export function remoteLabel(url: string | null): string | null {
  if (url === null || url.trim() === "") return null;
  const trimmed = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  if (withScheme !== null) return `${withScheme[1]}/${withScheme[2]}`;
  const scpLike = /^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/.exec(trimmed);
  if (scpLike !== null) return `${scpLike[1]}/${scpLike[2]}`;
  return trimmed;
}

/**
 * The picker's order: projects not in Taro first, the most recently used first (never used last,
 * then by name), and those already in Taro at the bottom by name.
 */
export function sortCandidates(candidates: readonly PaseoProjectCandidate[]): PaseoProjectCandidate[] {
  const byName = (left: PaseoProjectCandidate, right: PaseoProjectCandidate) => left.name.localeCompare(right.name);
  const fresh = candidates.filter((candidate) => candidate.taroProject === null);
  const onboarded = candidates.filter((candidate) => candidate.taroProject !== null);
  fresh.sort((left, right) => {
    if (left.lastActiveAt === right.lastActiveAt) return byName(left, right);
    if (left.lastActiveAt === null) return 1;
    if (right.lastActiveAt === null) return -1;
    return right.lastActiveAt.localeCompare(left.lastActiveAt);
  });
  return [...fresh, ...onboarded.sort(byName)];
}

/** The candidates whose name, path or remote holds every word of the search, ignoring case. */
export function filterCandidates(candidates: readonly PaseoProjectCandidate[], search: string): PaseoProjectCandidate[] {
  const words = search.toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [...candidates];
  return candidates.filter((candidate) => {
    const text = [candidate.name, candidate.repoPath, remoteLabel(candidate.remoteUrl) ?? "", candidate.taroProject ?? ""].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/**
 * The draft picking a project fills in. Models, limits and merging come from the last project's
 * settings (the form's defaults before the first); ticket sync and delivery follow the remote:
 * without one nothing can be pushed, so tickets stay on this machine and owners leave a local branch.
 */
export function candidateDraft(candidate: PaseoProjectCandidate, template: SettingsTemplate | null, takenPrefixes: readonly string[]): SetupDraft {
  const blank = draftFrom(null);
  const project = suggestProjectName(candidate.name);
  const hasRemote = candidate.remoteUrl !== null;
  return {
    ...blank,
    project,
    repoPath: candidate.repoPath,
    baseBranch: candidate.defaultBranch,
    ticketPrefix: suggestTicketPrefix(project, takenPrefixes),
    managerModel: template?.manager.model ?? blank.managerModel,
    managerThinking: template?.manager.thinking ?? blank.managerThinking,
    ownerModel: template?.owner.model ?? blank.ownerModel,
    ownerThinking: template?.owner.thinking ?? blank.ownerThinking,
    subagentModels: template?.subagentModels ?? blank.subagentModels,
    delivery: hasRemote ? (template?.delivery ?? "pull-request") : "local-only",
    acceptAlsoMerges: template?.acceptAlsoMerges ?? blank.acceptAlsoMerges,
    trackerSync: hasRemote ? "remote" : "local",
    compactThresholdTokens: String(template?.compactThresholdTokens ?? blank.compactThresholdTokens),
    idleCompactThresholdTokens: String(template?.idleCompactThresholdTokens ?? blank.idleCompactThresholdTokens),
    maxParallelOwners: String(template?.maxParallelOwners ?? blank.maxParallelOwners),
  };
}

/** "Manager Sonnet 5.5 · Owner Opus 5.5 · Pull request, merged when you accept": the settings the review page does not ask about. */
export function settingsSummary(draft: SetupDraft, modelLabel: (model: string) => string): string {
  const delivery =
    draft.delivery === "pull-request"
      ? draft.acceptAlsoMerges
        ? "Pull request, merged when you accept"
        : "Pull request, you merge"
      : draft.acceptAlsoMerges
        ? "Local branch, merged when you accept"
        : "Local branch, you merge";
  const models = draft.managerModel === "" ? [] : [`Manager ${modelLabel(draft.managerModel)}`, `Owner ${modelLabel(draft.ownerModel)}`];
  return [...models, delivery].join(" · ");
}
