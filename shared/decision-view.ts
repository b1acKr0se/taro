/**
 * What a decision block in an agent's transcript should show (TR-014): the
 * live card while Taro still holds it open, otherwise a short note of what
 * became of it. Pure, so the in-tab renderer stays a thin view.
 */
import { asStored } from "./planning-questions";
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
  if (!sameQuestion(asStored(block, stored), stored)) return { kind: "replaced" };
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
  return { ...block, key: "", project: "", ticket: null, agentId, agentRole: "owner", agentTitle: null, askedAt: "", turn: null, status: "open", answer: null };
}

/** One option as the card draws it: a full-width row, the recommended one carrying the reason (TR-030). */
export type DecisionOptionRow = { label: string; prompt: string; consequence: string; images: OptionImage[]; recommended: boolean; reason: string };

/**
 * An option that only stands for typing (TR-061): "Change", "Other" or "Something else", with or
 * without a trailing "…", "..." or ":". The card's field already means that, so it is hidden.
 */
export function isChangeOption(label: string): boolean {
  return /^(change|other|something else)\s*(…|\.\.\.|:)?$/i.test(label.trim());
}

/** The options a card shows: every one but those that only stand for typing. */
function shownOptions<Option extends { label: string }>(options: readonly Option[]): Option[] {
  return options.filter((option) => !isChangeOption(option.label));
}

/**
 * The card's option rows in the agent's order, without change options. The reason sits on the
 * recommended row; when the recommendation names no shown option (an incomplete block, or a hidden
 * one), it comes back as `looseReason` so it is still shown, under the rows. `hidden` counts the
 * change options left out.
 */
export function decisionOptionRows(decision: Pick<StoredDecision, "options" | "recommended" | "reason">): { rows: DecisionOptionRow[]; looseReason: string; hidden: number } {
  const options = shownOptions(decision.options);
  const recommendedIndex = options.findIndex((option) => option.label === decision.recommended);
  const rows = options.map((option, index) => ({
    label: option.label,
    prompt: option.prompt,
    consequence: option.consequence,
    // A decision held in a cache from before TR-055 has no images.
    images: option.images ?? [],
    recommended: index === recommendedIndex,
    reason: index === recommendedIndex ? decision.reason : "",
  }));
  return { rows, looseReason: recommendedIndex === -1 ? decision.reason : "", hidden: decision.options.length - options.length };
}

export const ANSWER_PLACEHOLDER = "Answer in your own words…";
export const CHANGE_PLACEHOLDER = "Describe a change…";
/** The preset id of an owner's scope approval (`skill/reference/formats.md`). */
export const SCOPE_APPROVAL = "scope-approval";

function isApproveLabel(label: string): boolean {
  return /^approve/i.test(label.trim());
}

/**
 * What the field says with no option picked: on an approval (a scope approval, an Approve option,
 * or one whose change option was hidden) typing asks for a change; otherwise it is an answer.
 */
export function answerPlaceholder(decision: Pick<StoredDecision, "id" | "options">): string {
  const approval = decision.id === SCOPE_APPROVAL || decision.options.some((option) => isChangeOption(option.label) || isApproveLabel(option.label));
  return approval ? CHANGE_PLACEHOLDER : ANSWER_PLACEHOLDER;
}

/**
 * The plan card's buttons (TR-061): Approve sends an option starting with "Approve" (the
 * recommended one when there are several), or else the recommended one; every other shown option
 * is a button beside it. `approveLabel` is what the filled button says: "Approve" only when that is
 * the label it sends, so it never reads Approve while sending other words. Null when there is
 * nothing for Approve to send, and the decision keeps the usual card.
 */
export function planCardOptions(
  decision: Pick<StoredDecision, "options" | "recommended">,
): { approve: string; approveLabel: string; others: { label: string; asksForWords: boolean }[] } | null {
  const options = shownOptions(decision.options);
  const approves = options.filter((option) => isApproveLabel(option.label));
  const recommended = options.find((option) => option.label === decision.recommended);
  const approve = approves.find((option) => option === recommended) ?? approves[0] ?? recommended;
  if (approve === undefined) return null;
  return {
    approve: approve.label,
    approveLabel: approve.label.trim().toLowerCase() === "approve" ? "Approve" : approve.label.trim(),
    others: options.filter((option) => option !== approve).map((option) => ({ label: option.label, asksForWords: optionAsksForWords(option) })),
  };
}

/** Where a scope approval's buttons are drawn: the compact card, the card with the plan unfolded in place, or the Ticket tab's Plan. */
export type PlanActionsPlace = "card" | "unfolded card" | "ticket plan";

/**
 * The plan's change box (TR-112), opened as on the acceptance card: by Request changes… (`option`
 * null), sending the typed words alone, or by an option that asks for words, sending both. Send
 * waits for words.
 */
export function planChangeBox(option: string | null, typed: string): { sendLabel: string; placeholder: string; enabled: boolean; label: string | null; text: string } {
  const text = typed.trim();
  if (option === null) return { sendLabel: "Send changes", placeholder: CHANGE_PLACEHOLDER, enabled: text !== "", label: null, text };
  return { sendLabel: "Send", placeholder: `Say how for “${option.trim().replace(/…$/, "")}”…`, enabled: text !== "", label: option, text };
}

/** What is picked on a decision card: one of its option rows, the Other row under them, or nothing. */
export type DecisionPick = number | "other" | null;

/**
 * What Submit sends and whether it can: the picked option (or none) and the typed words. `fieldEnabled`:
 * whether the box takes words; otherwise it is greyed, keeping whatever was typed (TR-083).
 */
export type DecisionSubmit = { enabled: boolean; label: string | null; text: string; placeholder: string; fieldEnabled: boolean };

/**
 * The card's Submit (TR-030, TR-083): a regular option is sent alone, with no note; Other sends the
 * typed words; an option ending with "…" asks for words and sends both (the server joins them,
 * TR-028). Words typed under Other and then left greyed by another pick are not sent with it.
 */
export function decisionSubmit(rows: DecisionOptionRow[], picked: DecisionPick, typed: string, freePlaceholder: string = ANSWER_PLACEHOLDER): DecisionSubmit {
  const words = typed.trim();
  if (picked === "other") return { enabled: words !== "", label: null, text: words, placeholder: freePlaceholder, fieldEnabled: true };
  const row = picked === null ? null : rows[picked] ?? null;
  if (row === null) return { enabled: false, label: null, text: "", placeholder: freePlaceholder, fieldEnabled: false };
  if (optionAsksForWords(row)) {
    return { enabled: words !== "", label: row.label, text: words, placeholder: `Say how for “${row.label.trim().replace(/…$/, "")}”…`, fieldEnabled: true };
  }
  return { enabled: true, label: row.label, text: "", placeholder: freePlaceholder, fieldEnabled: false };
}

/** An option ending with "…" (its label or prompt) asks the user for words. */
export function optionAsksForWords(option: { label: string; prompt: string }): boolean {
  return option.label.trim().endsWith("…") || option.prompt.trim().endsWith("…");
}

/** One option as a board card's chip (TR-045): pressing it answers at once, unless it asks for words. */
export type OptionChip = { label: string; recommended: boolean; asksForWords: boolean };

/** The card's chips in the agent's order without change options, the recommended one marked; labels keep the agent's words. */
export function optionChips(decision: Pick<StoredDecision, "options" | "recommended" | "reason">): OptionChip[] {
  return decisionOptionRows(decision).rows.map((row) => ({ label: row.label, recommended: row.recommended, asksForWords: optionAsksForWords(row) }));
}

/**
 * Who asked, as a card's head says it: "notes · SC-003 · Add validation". The agent's title already
 * starts with its ticket when it has one, and a manager's with its project ("notes · Manager").
 */
export function askedBy(decision: Pick<StoredDecision, "project" | "ticket" | "agentTitle" | "agentRole">): string {
  const title = decision.agentTitle ?? decision.agentRole;
  const project = title.startsWith(`${decision.project} ·`) ? "" : `${decision.project} · `;
  if (decision.ticket === null || title.startsWith(decision.ticket)) return `${project}${title}`;
  return `${project}${decision.ticket} · ${title}`;
}

/**
 * Whether a scope approval is answered from the Ticket view (TR-061): one on this ticket with
 * something for Approve to send. The Ticket view then draws its Approve rows (the summary block's
 * and the Plan's), and the ticket panel leaves the decision's own card out, so it is answered in one
 * place whether or not the plan follows the template. The Plan section shows while a scope approval
 * is open, so its row and field are there even without a plan.
 */
export function answeredInPlan(decision: Pick<StoredDecision, "id" | "ticket" | "options" | "recommended">, ticket: string | null): boolean {
  return ticket !== null && decision.ticket === ticket && decision.id === SCOPE_APPROVAL && planCardOptions(decision) !== null;
}

/** The open scope approval the Ticket view answers, with its buttons; null when it has none to answer. */
export function ticketViewApproval<Decision extends Pick<StoredDecision, "id" | "ticket" | "options" | "recommended" | "status">>(
  decisions: readonly Decision[],
  ticket: string,
): { decision: Decision; options: NonNullable<ReturnType<typeof planCardOptions>> } | null {
  const decision = decisions.find((each) => each.status === "open" && answeredInPlan(each, ticket));
  const options = decision === undefined ? null : planCardOptions(decision);
  return decision === undefined || options === null ? null : { decision, options };
}
