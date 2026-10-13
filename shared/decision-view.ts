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
  /** Shown but not answerable, with why: still loading, the lookup failed, or Taro holds no record. */
  | { kind: "read-only"; note: string };

/** Where the renderer's lookup of the stored decision stands. */
export type DecisionLookup =
  | { state: "loading" }
  | { state: "error" }
  | { state: "done"; decision: StoredDecision | null; agentLive: boolean };

export const READ_ONLY_NOTES = {
  loading: "Looking this decision up…",
  error: "Could not look this decision up; answer it from the Taro screen or reply in the message box.",
  // Not a Taro agent, or the decision closed long enough ago for Taro to have dropped it.
  untracked: "Taro has no record of this decision (not a Taro agent, or settled over 14 days ago). Reply in the message box if it still needs an answer.",
} as const;

export function decisionBlockView(block: ParsedDecision, lookup: DecisionLookup): DecisionBlockView {
  if (block.withdrawn) return { kind: "withdrawal" };
  if (lookup.state !== "done") return { kind: "read-only", note: READ_ONLY_NOTES[lookup.state] };
  const stored = lookup.decision;
  if (stored === null) return { kind: "read-only", note: READ_ONLY_NOTES.untracked };
  if (!sameQuestion(block, stored)) return { kind: "replaced" };
  if (stored.status === "answered") return { kind: "answered", answer: stored.answer?.text ?? "", label: stored.answer?.label ?? null };
  if (stored.status === "withdrawn" || !lookup.agentLive) return { kind: "withdrawn" };
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
