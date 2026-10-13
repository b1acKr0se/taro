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
