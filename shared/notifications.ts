/**
 * What enters Needs you, as notifications (TR-059): one per entry, keyed so the same entry is
 * announced once, and worded for a phone's lock screen. Paseo pushes nothing for task owners (it
 * skips agents with a parent), so Taro announces its own. Pure.
 */
import { z } from "zod";

import { alertHeading } from "./alerts";
import type { AgentAskView, Board, Card } from "./contracts";
import type { BoardAlert } from "./recovery";
import type { StoredDecision } from "./state";

export interface NeedsYouEntry {
  /**
   * Stable while the entry lasts; a new ask (another decision or request) gets a new one. A delivery
   * or a block has no id of its own, so its key starts with `WHILE_WAITING` and is forgotten the
   * moment it leaves: the next delivery or block is announced again.
   */
  key: string;
  title: string;
  body: string;
  /** The agent a tap opens, when there is one. */
  agentId: string | null;
  workspaceId: string | null;
}

/** The longest body kept; Paseo cuts its own previews at 220 characters. */
const BODY_CHARACTERS = 220;

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > BODY_CHARACTERS ? `${line.slice(0, BODY_CHARACTERS - 1)}…` : line;
}

function decisionEntry(decision: StoredDecision, title: string, workspaceId: string | null): NeedsYouEntry {
  return {
    key: `decision:${decision.key}:${decision.askedAt}`,
    title,
    body: clip(decision.question),
    agentId: decision.agentId,
    workspaceId,
  };
}

/** The key prefix of an entry that is one episode (a delivery, a block), not one ask with an id. */
export const WHILE_WAITING = "while-waiting:";

function cardEntries(card: Card): NeedsYouEntry[] {
  const agentId = card.owner?.id ?? null;
  const workspaceId = card.owner?.workspaceId ?? null;
  const entry = (kind: string, title: string, body: string): NeedsYouEntry => ({
    key: `${card.id}:${kind}`,
    title,
    body: clip(body === "" ? card.title : body),
    agentId,
    workspaceId,
  });
  // Keyed by the ticket alone: the summary or the status line may change while it waits, and must not announce it again.
  const waiting = (kind: string, title: string, body: string): NeedsYouEntry => ({ ...entry(kind, title, body), key: `${WHILE_WAITING}${card.id}:${kind}` });
  const episode = (): NeedsYouEntry[] => {
    if (card.status === "Awaiting acceptance" && card.accepted === null) {
      // Accepted and not merged (TR-109): the reason is what to act on before accepting again.
      if (card.notMerged !== null)
        return [waiting("not-merged", card.notMerged.merged ? `${card.id} merged; local base branch not updated` : `${card.id} was not merged`, card.notMerged.reason)];
      return [waiting("accept", `${card.id} is ready to accept`, card.delivered ?? card.title)];
    }
    if (card.status === "Blocked" || card.lastStatus?.state === "blocked") {
      const said = card.lastStatus?.state === "blocked" ? card.lastStatus.text : card.title;
      return [waiting("blocked", `${card.id} is blocked`, said)];
    }
    return [];
  };
  // A stall over a delivery or a block keeps that entry, so the stall clearing does not announce it again.
  if (card.column === "stalled") {
    return [entry(`stalled:${agentId ?? "none"}`, `${card.id} stalled`, card.stalledReason ?? card.lastStatus?.text ?? card.title), ...episode()];
  }
  const entries: NeedsYouEntry[] = [];
  if (card.permission !== null) entries.push(permissionEntry(card.permission, `${card.id}:`, card.id, agentId, workspaceId));
  for (const decision of card.decisions) {
    if (decision.blocking) entries.push(decisionEntry(decision, `${card.id} asks`, decision.agentId === agentId ? workspaceId : null));
  }
  return card.column === "needs-you" ? [...entries, ...episode()] : entries;
}

/**
 * A pending permission (TR-059), named for who asks when it is not the card's owner (TR-096): a tap
 * opens the agent that asks, where Allow and Deny are. `whose` is the ticket, or null for the manager's side.
 */
function permissionEntry(ask: AgentAskView, keyPrefix: string, whose: string | null, fallbackAgentId: string | null, fallbackWorkspaceId: string | null): NeedsYouEntry {
  const text = ask.detail === null ? ask.title : `${ask.title} ${ask.detail}`;
  const agentId = ask.agentId ?? fallbackAgentId;
  const job = ask.role === null || ask.role === "owner" || ask.role === "manager" ? null : ask.role;
  const who = whose === null ? (job === null ? "The manager" : `The manager's ${job}`) : job === null ? whose : `${whose}'s ${job}`;
  return {
    key: `${keyPrefix}permission:${agentId ?? "none"}:${ask.id ?? text}`,
    title: `${who} needs permission`,
    body: clip(text),
    agentId,
    workspaceId: ask.workspaceId ?? fallbackWorkspaceId,
  };
}

/**
 * A board alert (TR-064), announced once while it is up: keyed by its kind alone, so its minutes
 * changing or a ticket joining the queued one does not announce it again, and forgotten when it
 * clears, so its next episode is announced. A tap opens the manager, which can act on any of them.
 */
function alertEntry(project: string, alert: BoardAlert, managerAgentId: string | null, managerWorkspaceId: string | null): NeedsYouEntry {
  const key = `${WHILE_WAITING}alert:${alert.id}`;
  return {
    key,
    // A project's alert names it; the host's (threads) is on every board and is announced once, unnamed.
    title: isHostEntry(key) ? alertHeading(alert.id) : `${alertHeading(alert.id)} in ${project}`,
    body: clip(alert.text),
    agentId: managerAgentId,
    workspaceId: managerWorkspaceId,
  };
}

/** The alerts about the host, not a project: every project's board carries them. */
const HOST_ALERT_IDS: readonly string[] = ["headroom"];

/** An entry about the host, kept seen once for all projects (`HOST_SEEN`), so it is announced once. */
export function isHostEntry(key: string): boolean {
  return HOST_ALERT_IDS.some((id) => key === `${WHILE_WAITING}alert:${id}`);
}

/** Where host entries are kept seen; not a project name, which never starts with "*". */
export const HOST_SEEN = "*host";

/** Every entry of a project's board that waits on the user. */
export function needsYouEntries(board: Board, managerWorkspaceId: string | null, managerAgentId: string | null = null): NeedsYouEntry[] {
  return [
    ...board.alerts.map((alert) => alertEntry(board.project, alert, managerAgentId, managerWorkspaceId)),
    ...board.cards.filter((card) => card.status !== "Done" && card.status !== "Cancelled").flatMap((card) => cardEntries(card)),
    ...board.managerDecisions.map((decision) => decisionEntry(decision, "The manager asks", managerWorkspaceId)),
    ...(board.managerPermission === null ? [] : [permissionEntry(board.managerPermission, "manager:", null, managerAgentId, managerWorkspaceId)]),
  ];
}

/**
 * The keys last seen, with when. An entry that leaves and comes back within this long (a stall that
 * clears for a moment, a request listed again) is the same entry, and is not announced again; a
 * `WHILE_WAITING` entry is forgotten as soon as it leaves.
 */
export const REMEMBER_MS = 60 * 60_000;

export const SeenEntriesSchema = z.record(z.string(), z.number());
export type SeenEntries = z.infer<typeof SeenEntriesSchema>;

/**
 * The entries to announce and the keys to keep. With nothing kept yet (a project's first check),
 * what already waits is taken as known: turning the feature on announces nothing old.
 */
export function freshEntries(
  seen: SeenEntries | null,
  entries: readonly NeedsYouEntry[],
  now: number,
): { fresh: NeedsYouEntry[]; seen: SeenEntries } {
  const next: SeenEntries = {};
  const present = new Set(entries.map((entry) => entry.key));
  for (const [key, at] of Object.entries(seen ?? {})) {
    if (now - at < REMEMBER_MS && (present.has(key) || !key.startsWith(WHILE_WAITING))) next[key] = at;
  }
  const fresh = seen === null ? [] : entries.filter((entry, index) => next[entry.key] === undefined && entries.findIndex((other) => other.key === entry.key) === index);
  for (const entry of entries) next[entry.key] = now;
  return { fresh, seen: next };
}

/** Paseo's own rule (`PRESENCE_THRESHOLD_MS`): someone who used a window this recently is there to see it. */
export const PRESENCE_MS = 180_000;

export function someonePresent(lastActiveAt: Iterable<number>, now: number): boolean {
  for (const at of lastActiveAt) {
    if (now - Math.min(at, now) <= PRESENCE_MS) return true;
  }
  return false;
}
