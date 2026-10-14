/** The manager's suggestions file (decision 39): `- <label> :: <prompt>` per line. Pure. */
export interface Suggestion {
  label: string;
  prompt: string;
}

export function parseSuggestions(text: string): Suggestion[] {
  const withoutNotes = text.replace(/<!--[\s\S]*?-->/g, "");
  const suggestions: Suggestion[] = [];
  for (const line of withoutNotes.split("\n")) {
    const match = /^\s*[-*]\s+(.+?)\s+::\s+(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) suggestions.push({ label: match[1], prompt: match[2] });
  }
  return suggestions;
}

export function suggestionKey(suggestion: Suggestion): string {
  return `${suggestion.label}\u0000${suggestion.prompt}`;
}

/** `TR-005`, `tr-5` and `TR-005.01` as one canonical form: prefix upper-cased, leading zeros dropped. */
function canonicalTicketId(prefix: string, number: string): string {
  return `${prefix.toUpperCase()}-${number.split(".").map((part) => String(Number(part))).join(".")}`;
}

/** Ticket ids written anywhere in the text; `TR-005` inside `TR-005.1` or `XTR-005` is not one. */
export function mentionedTicketIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const match of text.matchAll(/(?<![A-Za-z0-9])([A-Za-z]+)-(\d+(?:\.\d+)*)(?![A-Za-z0-9]|\.\d)/g)) {
    if (match[1] !== undefined && match[2] !== undefined) ids.add(canonicalTicketId(match[1], match[2]));
  }
  return ids;
}

const MINUTE_MS = 60_000;

/**
 * Drops suggestions about a ticket that changed after the file was written (decision 39): the
 * manager is not woken when tickets move on their own, so it cannot retire them itself. Backlog
 * keeps update times to the minute, so only a change in a later minute than the write counts.
 */
export function currentSuggestions(
  suggestions: readonly Suggestion[],
  writtenAt: number,
  tickets: readonly { id: string; updatedAt: string | null }[],
): Suggestion[] {
  const firstLaterMinute = Math.floor(writtenAt / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const changed = new Set(
    tickets
      .filter((ticket) => ticket.updatedAt !== null && Date.parse(ticket.updatedAt) >= firstLaterMinute)
      .map((ticket) => [...mentionedTicketIds(ticket.id)][0] ?? ticket.id),
  );
  return suggestions.filter((suggestion) => {
    const mentioned = mentionedTicketIds(`${suggestion.label} ${suggestion.prompt}`);
    return ![...mentioned].some((id) => changed.has(id));
  });
}

/** A suggestion starting like this, about no ticket, is what the Catch up or Compact button beside the composer already does. */
const FIXED_ACTION = /^\s*(?:catch (?:me )?up|compact)\b/i;

/** Drops suggestions that repeat the always-present Catch up and Compact buttons (TR-047); "Compact TR-012" is another action. */
export function withoutFixedActions(suggestions: readonly Suggestion[]): Suggestion[] {
  return suggestions.filter((suggestion) => {
    const duplicates = FIXED_ACTION.test(suggestion.label) || FIXED_ACTION.test(suggestion.prompt);
    return !duplicates || mentionedTicketIds(`${suggestion.label} ${suggestion.prompt}`).size > 0;
  });
}

/** Where sending one suggestion to the manager stands, as the board draws it (TR-032). */
export type SendState = "sending" | "sent" | "failed";

export interface SuggestionSend {
  suggestion: Suggestion;
  state: SendState;
  /** Its place in the row when pressed, so it stays there if the board drops it meanwhile. */
  index: number;
  /** Why it failed, for the pill's accessibility label. */
  reason?: string;
}

export interface SuggestionPill {
  suggestion: Suggestion;
  state: SendState | "idle";
  reason?: string;
}

/**
 * The row of pills: the board's suggestions with their send state. One being sent or just sent stays
 * at its place after the board drops it (it is dismissed on success, and the manager may rewrite the
 * file), so the user sees "Sent" before it goes; a failed one the manager no longer suggests goes.
 */
export function suggestionPills(current: readonly Suggestion[], sends: readonly SuggestionSend[]): SuggestionPill[] {
  const byKey = new Map(sends.map((send) => [suggestionKey(send.suggestion), send]));
  const present = new Set(current.map(suggestionKey));
  const pills: SuggestionPill[] = current.map((suggestion) => {
    const send = byKey.get(suggestionKey(suggestion));
    return send?.reason === undefined ? { suggestion, state: send?.state ?? "idle" } : { suggestion, state: send.state, reason: send.reason };
  });
  const dropped = sends.filter((send) => send.state !== "failed" && !present.has(suggestionKey(send.suggestion))).sort((left, right) => left.index - right.index);
  for (const send of dropped) pills.splice(Math.min(send.index, pills.length), 0, { suggestion: send.suggestion, state: send.state });
  return pills;
}

/** Whether a sideways row has more past its right edge; a pixel of rounding is not more. */
export function moreToTheRight(offset: number, viewportWidth: number, contentWidth: number): boolean {
  return contentWidth - offset - viewportWidth > 1;
}
