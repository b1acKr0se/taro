/**
 * What a decision block in an agent's transcript should show (TR-014): the
 * live card while Taro still holds it open, otherwise a short note of what
 * became of it. Pure, so the in-tab renderer stays a thin view.
 */
import { decisionMessageSegments, sameQuestion, type ParsedDecision } from "./reports";
import type { StoredDecision } from "./state";

export type DecisionBlockView =
  /** Taro holds it open and the agent is live: the answerable card. */
  | { kind: "open"; decision: StoredDecision }
  | { kind: "answered"; answer: string; label: string | null }
  /** Withdrawn by the agent or by Taro (its agent archived or replaced). */
  | { kind: "withdrawn" }
  /** The block that withdraws an earlier one. */
  | { kind: "withdrawal" }
  /** A later block with the same id asks something else; that one is the live card. */
  | { kind: "replaced" }
  /** Taro does not hold it: not a Taro agent, or the turn is not ingested yet. */
  | { kind: "untracked" };

export function decisionBlockView(block: ParsedDecision, stored: StoredDecision | null, agentLive: boolean): DecisionBlockView {
  if (block.withdrawn) return { kind: "withdrawal" };
  if (stored === null) return { kind: "untracked" };
  if (!sameQuestion(block, stored)) return { kind: "replaced" };
  if (stored.status === "answered") return { kind: "answered", answer: stored.answer?.text ?? "", label: stored.answer?.label ?? null };
  if (stored.status === "withdrawn" || !agentLive) return { kind: "withdrawn" };
  return { kind: "open", decision: stored };
}

export const DECISION_TEXT_KIND = "taro-decision-text";
export const DECISION_BLOCK_KIND = "taro-decision-block";

/** The plugin timeline items a message becomes (Paseo's `PluginTimelineItem`, kept structural here). */
export type DecisionTimelineItem =
  | { type: "plugin"; id: string; kind: typeof DECISION_TEXT_KIND; version: 1; data: { text: string } }
  | { type: "plugin"; id: string; kind: typeof DECISION_BLOCK_KIND; version: 1; data: { decision: ParsedDecision } };

/**
 * The transformer's whole decision: a finished assistant message holding a
 * decision block becomes its text and blocks as plugin items; anything else
 * stays Paseo's (undefined). A streaming message is left alone, since a half
 * written block cannot be parsed yet.
 */
export function decisionTimelineItems(text: string, phase: "streaming" | "complete"): { items: DecisionTimelineItem[] } | undefined {
  if (phase !== "complete") return undefined;
  const segments = decisionMessageSegments(text);
  if (segments === null) return undefined;
  return {
    items: segments.map((segment, index): DecisionTimelineItem =>
      segment.kind === "text"
        ? { type: "plugin", id: `segment-${index}`, kind: DECISION_TEXT_KIND, version: 1, data: { text: segment.text } }
        : { type: "plugin", id: `segment-${index}`, kind: DECISION_BLOCK_KIND, version: 1, data: { decision: segment.decision } },
    ),
  };
}

/** A block Taro does not hold, shaped for the card so it can be shown read-only. */
export function untrackedDecision(block: ParsedDecision, agentId: string): StoredDecision {
  return { ...block, key: "", project: "", ticket: null, agentId, agentRole: "owner", agentTitle: null, askedAt: "", status: "open", answer: null };
}
