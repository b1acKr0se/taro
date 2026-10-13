/**
 * The one line a board card gives to what is happening now (TR-026): the first of why it stalled,
 * what it asks of you, the subagent the owner waits on, or the owner's last status line. Everything
 * else that used to repeat it (the latest milestone, a second status line) stays off the card. Pure.
 */
import type { Card } from "../shared/contracts";
import type { StatusState } from "../shared/reports";
import { cardCalls, type CardCall } from "./card-calls";
import { formatTokenCount } from "./format";
import { waitingOnText } from "./pane-agents";

export type NowLine =
  | { kind: "stalled"; text: string; at: string | null }
  /** `more` counts every other open ask: further decisions, and acceptance or permissions beside it. */
  | { kind: "call"; call: CardCall; more: number }
  | { kind: "subagent"; text: string }
  | { kind: "status"; state: StatusState; text: string; at: string };

export function cardNowLine(card: Card, now: number): NowLine | null {
  if (card.column === "stalled") return { kind: "stalled", text: stalledText(card), at: card.lastStatus?.at ?? null };
  const calls = cardCalls(card);
  const first = calls[0];
  if (first !== undefined) {
    const more = calls.length - 1 + calls.reduce((sum, call) => sum + (call.kind === "decision" ? call.more : 0), 0);
    return { kind: "call", call: first, more };
  }
  const waitingOn = waitingOnText(card, now);
  if (waitingOn !== null) return { kind: "subagent", text: waitingOn };
  if (card.lastStatus !== null) return { kind: "status", ...card.lastStatus };
  return null;
}

/** Why a stalled card stopped, from the plugin's reason or else from the owner's Paseo status and last words. */
function stalledText(card: Card): string {
  if (card.stalledReason !== null) return card.stalledReason;
  if (card.owner === null) return "No owner is running";
  if (card.owner.status === "error") return "The owner stopped with an error";
  if (card.owner.status === "closed") return "The owner was closed";
  const last = card.lastStatus;
  if (last !== null && last.state === "failed") return `Failed: ${last.text}`;
  return last === null ? "Still idle after a nudge" : `Still idle after a nudge: ${last.text}`;
}

/** Over this much context an idle owner offers Compact on its card. */
export const COMPACT_OFFER_TOKENS = 150_000;

/** The card's muted footer, in order: complexity, investigation, where the owner runs, context, subagents. */
export function cardFooterParts(card: Card): string[] {
  const parts: string[] = [];
  if (card.complexity !== null) parts.push(card.complexity);
  if (card.investigation) parts.push("investigation");
  if (card.ownerElsewhere !== null) parts.push(`on ${card.ownerElsewhere}`);
  const used = card.owner?.contextUsedTokens ?? null;
  if (used !== null) parts.push(`context ${formatTokenCount(used)}`);
  if (card.subagents.length > 0) parts.push(`${card.subagents.length} subagent${card.subagents.length === 1 ? "" : "s"}`);
  return parts;
}

export function offersCompact(card: Card): boolean {
  const owner = card.owner;
  return owner !== null && owner.status === "idle" && (owner.contextUsedTokens ?? 0) > COMPACT_OFFER_TOKENS;
}
