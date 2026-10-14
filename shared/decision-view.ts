/**
 * What a decision block in an agent's transcript should show (TR-014): the
 * live card while Taro still holds it open, otherwise a short note of what
 * became of it. Pure, so the in-tab renderer stays a thin view.
 */
import { decisionMessageSegments, sameQuestion, type OptionImage, type ParsedDecision } from "./reports";
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

/** One option as the card draws it: a full-width row, the recommended one carrying the reason (TR-030). */
export type DecisionOptionRow = { label: string; prompt: string; consequence: string; images: OptionImage[]; recommended: boolean; reason: string };

/**
 * The card's option rows in the agent's order. The reason sits on the recommended row; when the
 * recommendation names no option (an incomplete block), it comes back as `looseReason` so it is
 * still shown, under the rows.
 */
export function decisionOptionRows(decision: Pick<StoredDecision, "options" | "recommended" | "reason">): { rows: DecisionOptionRow[]; looseReason: string } {
  const recommendedIndex = decision.options.findIndex((option) => option.label === decision.recommended);
  const rows = decision.options.map((option, index) => ({
    label: option.label,
    prompt: option.prompt,
    consequence: option.consequence,
    images: option.images,
    recommended: index === recommendedIndex,
    reason: index === recommendedIndex ? decision.reason : "",
  }));
  return { rows, looseReason: recommendedIndex === -1 ? decision.reason : "" };
}

/** What Submit sends and whether it can: the picked option (or none) and the typed words. */
export type DecisionSubmit = { enabled: boolean; label: string | null; text: string; placeholder: string };

/**
 * The card's Submit (TR-030): a picked option, typed words, or both (the server joins them,
 * TR-028). An option ending with "…" asks for words, so it waits for them.
 */
export function decisionSubmit(rows: DecisionOptionRow[], picked: number | null, typed: string): DecisionSubmit {
  const row = picked === null ? null : rows[picked] ?? null;
  const words = typed.trim();
  const asksForWords = row !== null && optionAsksForWords(row);
  return {
    enabled: asksForWords ? words !== "" : row !== null || words !== "",
    label: row?.label ?? null,
    text: words,
    placeholder: asksForWords ? `Say how for “${row.label.trim().replace(/…$/, "")}”…` : row === null ? "Or answer in your own words…" : "Add a note (optional)…",
  };
}

/** An option ending with "…" (its label or prompt) asks the user for words. */
export function optionAsksForWords(option: { label: string; prompt: string }): boolean {
  return option.label.trim().endsWith("…") || option.prompt.trim().endsWith("…");
}

/** One option as a board card's chip (TR-045): pressing it answers at once, unless it asks for words. */
export type OptionChip = { label: string; recommended: boolean; asksForWords: boolean };

/** The card's chips in the agent's order, the recommended one marked; labels keep the agent's words. */
export function optionChips(decision: Pick<StoredDecision, "options" | "recommended" | "reason">): OptionChip[] {
  return decisionOptionRows(decision).rows.map((row) => ({ label: row.label, recommended: row.recommended, asksForWords: optionAsksForWords(row) }));
}

/**
 * Who asked, as a card's head says it: "notes · SC-003 · Add validation". The agent's title already
 * starts with its ticket when it has one, and a Manager's with its project ("notes · Manager").
 */
export function askedBy(decision: Pick<StoredDecision, "project" | "ticket" | "agentTitle" | "agentRole">): string {
  const title = decision.agentTitle ?? decision.agentRole;
  const project = title.startsWith(`${decision.project} ·`) ? "" : `${decision.project} · `;
  if (decision.ticket === null || title.startsWith(decision.ticket)) return `${project}${title}`;
  return `${project}${decision.ticket} · ${title}`;
}
