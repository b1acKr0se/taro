/**
 * Accept run by the plugin (TR-141): the fixed steps an owner used to run after Accept (TR-109,
 * TR-110), without reloading the owner's context. What each step ends in, and the records written.
 * Anything that needs judgement (a moved head, a conflict, a base branch that moved under a local
 * branch, an unexpected gh or git answer) is a surprise, handed to an owner.
 */

/** How Accept ends when the plugin runs it. */
export type AcceptOutcome =
  /** Merged (or nothing to merge): the ACCEPTANCE record to write as the ticket goes Done. */
  | { kind: "done"; acceptance: string }
  /** Nothing merged because of the user's side; the NOT-MERGED reason and what they do first. */
  | { kind: "not-merged"; reason: string }
  /** The pull request merged but the main checkout could not follow; the NOT-SYNCED reason. */
  | { kind: "not-synced"; reason: string }
  /** What the plugin found that needs an owner. */
  | { kind: "surprise"; found: string };

/**
 * Under this since its last turn ended, the owner's prompt cache is warm on every provider, so a
 * surprise goes to it; past it, a fresh owner reads the ticket instead of the old chat (the user's rule).
 */
export const WARM_OWNER_MS = 5 * 60_000;

/** Whether a surprise goes to the current owner: it is mid-turn, or its last turn ended within WARM_OWNER_MS. */
export function ownerIsWarm(lastTurnEndedAt: string | null, midTurn: boolean, now: number): boolean {
  if (midTurn) return true;
  const ended = lastTurnEndedAt === null ? Number.NaN : Date.parse(lastTurnEndedAt);
  // An unknown time counts as cold: a fresh owner costs the same whatever the provider.
  return Number.isFinite(ended) && now - ended < WARM_OWNER_MS;
}

/** `gh pr view --json state,headRefOid,mergeCommit` as the steps need it; null when it says something else. */
export interface PullRequestView {
  state: string;
  headRefOid: string;
  mergeCommit: string | null;
}

export function parsePullRequestView(stdout: string): PullRequestView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const fields = parsed as Record<string, unknown>;
  if (typeof fields.state !== "string" || typeof fields.headRefOid !== "string") return null;
  const commit = fields.mergeCommit;
  const oid = typeof commit === "object" && commit !== null ? (commit as Record<string, unknown>).oid : null;
  return { state: fields.state.toUpperCase(), headRefOid: fields.headRefOid.toLowerCase(), mergeCommit: typeof oid === "string" && oid !== "" ? oid.toLowerCase() : null };
}

/** `git status --porcelain` as a short list for a reason line: at most three paths, then how many more. */
export function changedPaths(porcelain: string): string {
  const paths = porcelain
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter((path) => path !== "");
  const shown = paths.slice(0, 3).join(", ");
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

/** The ACCEPTANCE record the plugin writes; the merge field last, as the board reads it (TR-114). */
export function acceptanceText(at: string, ticket: string, prose: string, merge: string): string {
  return `ACCEPTANCE ${at} — user: "I accept ${ticket}." ${prose}; accepted and closed by the plugin; merge: ${merge}`;
}

/** Written when the plugin hands a surprise to an owner, so a restart does not run the steps again. */
export function handoffText(at: string, found: string, to: string): string {
  return `ACCEPT-HANDOFF ${at} — the plugin stopped: ${found}; handed to ${to}`;
}
