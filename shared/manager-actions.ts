/**
 * The manager's actions in project settings, the crashed alert and the manager pane (TR-072):
 * resume the same agent and conversation, or start a fresh one. Pure.
 */

export type ManagerActionKind = "launch" | "resume" | "fresh";

export const MANAGER_ACTION_LABELS: Readonly<Record<ManagerActionKind, string>> = {
  launch: "Start manager",
  resume: "Resume manager",
  fresh: "Start a fresh manager",
};

export const MANAGER_ACTION_SUCCESS: Readonly<Record<ManagerActionKind, string>> = {
  launch: "The manager started.",
  resume: "The manager resumed with its conversation.",
  fresh: "Fresh manager started; the old conversation is archived.",
};

/** The buttons the settings show and what they say: Start only without a manager, else Resume and a fresh start. */
export function managerSettingsActions(manager: { status: string } | null): { kinds: ManagerActionKind[]; description: string } {
  if (manager === null) return { kinds: ["launch"], description: "This project has no manager running. Start one; tickets are kept." };
  const crashed = manager.status === "error";
  return {
    kinds: ["resume", "fresh"],
    description: [
      crashed ? "The manager stopped with an error." : null,
      "Resume manager restarts the same manager in a new process, its conversation kept.",
      "Start a fresh manager archives this one (archived, not deleted) and starts a new conversation.",
      "Tickets are kept either way.",
    ]
      .filter((line) => line !== null)
      .join(" "),
  };
}

/** The manager pane's line over a crashed manager's chat, or null while it is fine. */
export function managerPaneNotice(manager: { status: string } | null): string | null {
  return manager !== null && manager.status === "error" ? "The manager stopped with an error. Resume manager brings it back with its conversation." : null;
}

/** Over this much context a manager idle past the prompt cache offers Replace manager (TR-128). */
export const REPLACE_OFFER_TOKENS = 100_000;
/** The provider's prompt cache: the hour idle compaction (TR-015) is timed against. */
export const PROMPT_CACHE_MS = 60 * 60_000;

export const REPLACE_MANAGER_LABEL = "Replace manager";

/**
 * Whether the manager pane offers Replace manager above the composer (TR-128): idle, its last turn
 * ended over an hour ago (so the cache is cold and the next message rereads the whole context
 * uncached), and over 100k tokens of context. An unknown turn end offers nothing.
 */
export function offersReplaceManager(manager: { status: string; contextUsedTokens: number | null } | null, lastTurnEndedAt: string | null, now: number): boolean {
  if (manager === null || manager.status !== "idle") return false;
  if (manager.contextUsedTokens === null || manager.contextUsedTokens <= REPLACE_OFFER_TOKENS) return false;
  const endedAt = lastTurnEndedAt === null ? Number.NaN : Date.parse(lastTurnEndedAt);
  return !Number.isNaN(endedAt) && now - endedAt >= PROMPT_CACHE_MS;
}

/** The notice's words; `tokens` is the context as the meter writes it ("142k"). */
export function replaceManagerNotice(tokens: string): string {
  return `Idle for over an hour with ${tokens} tokens of context: your next message rereads all of it uncached. A fresh manager starts small; tickets are kept and this conversation is archived.`;
}

/** The presses that, while Replace manager is offered, first ask to replace (TR-161). */
export type ReplaceFirstAction = "catch-up" | "compact" | "suggestion" | "send";

const GO_AHEAD_LABELS: Readonly<Record<ReplaceFirstAction, string>> = {
  "catch-up": "Catch up anyway",
  compact: "Compact anyway",
  suggestion: "Send suggestion anyway",
  send: "Send anyway",
};

/** The dialog a press opens while Replace manager is offered: why, and the label of going ahead with it. */
export function replaceFirstDialog(action: ReplaceFirstAction, tokens: string): { title: string; body: string; goAhead: string } {
  return {
    title: "Replace the manager first?",
    body: `${replaceManagerNotice(tokens)} Replacing it first is recommended.`,
    goAhead: GO_AHEAD_LABELS[action],
  };
}
