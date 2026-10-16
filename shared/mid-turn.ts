/**
 * The user's messages that reached an agent mid-turn, and whether the agent answered them (TR-168).
 *
 * Paseo records a message steered into a running turn as a `user_message` carrying that turn's id,
 * the same id as the message that opened it; the next turn has a new id. So a turn's messages after
 * its first entry arrived while the agent worked. An agent answers one by quoting the user's words
 * (`> …`, `skill/SKILL.md`), which is what is checked: in TR-166 a question absorbed mid-turn was
 * never answered, and nothing showed it. Pure, for vitest.
 */

export interface MidTurnItem {
  type: string;
  text?: string;
  clientMessageId?: string;
  messageId?: string;
}

export interface MidTurnEntry {
  item: MidTurnItem;
  turnId?: string;
}

/**
 * The entries of the turn `turnId` at the end of the timeline, oldest first: from the end back while
 * the id holds. Turn ids are counters ("foreground-turn-3") that may start over with a new session,
 * so only the run at the end counts. `complete` is false when the run reaches the page's start, as
 * the turn may begin on an older page.
 */
export function turnEntries<Entry extends MidTurnEntry>(entries: readonly Entry[], turnId: string): { entries: Entry[]; complete: boolean } {
  let start = entries.length;
  while (start > 0 && entries[start - 1]?.turnId === turnId) start -= 1;
  return { entries: entries.slice(start), complete: start > 0 };
}

/** The user's messages that arrived after the turn's opening entry; `isUsersWords` leaves out the plugin's own. */
export function midTurnMessages(turn: readonly MidTurnEntry[], isUsersWords: (item: MidTurnItem) => boolean): MidTurnItem[] {
  return turn.slice(1).flatMap((entry) => (entry.item.type === "user_message" && isUsersWords(entry.item) ? [entry.item] : []));
}

/** Words only, lower case: a quote keeps its meaning whatever its punctuation, ellipsis or line breaks. */
function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Each Markdown quote in the text, its consecutive `>` lines joined. */
export function quotes(text: string): string[] {
  const found: string[] = [];
  let current: string[] | null = null;
  for (const line of text.split("\n")) {
    const quoted = /^\s*>+ ?(.*)$/.exec(line);
    if (quoted !== null) {
      current = current ?? [];
      current.push(quoted[1] ?? "");
    } else if (current !== null) {
      found.push(current.join(" "));
      current = null;
    }
  }
  if (current !== null) found.push(current.join(" "));
  return found;
}

/** The shortest quote that counts: a few words, or the whole message when it is shorter. */
const MINIMUM_QUOTE = 20;

/** Whether the text quotes the message: some quote in it is a piece of the message of enough length. */
export function quotesMessage(text: string, message: string): boolean {
  const words = normalized(message);
  if (words === "") return true;
  return quotes(text).some((quote) => {
    const piece = normalized(quote);
    return piece !== "" && piece.length >= Math.min(MINIMUM_QUOTE, words.length) && words.includes(piece);
  });
}

/**
 * The mid-turn messages nothing after them in the timeline quotes. A message is found by its client
 * message id, else its text, at its last place; one not found there is left out, as it cannot be told.
 */
export function unansweredMessages(timeline: readonly MidTurnItem[], messages: readonly MidTurnItem[]): string[] {
  return messages.flatMap((message) => {
    const text = message.text ?? "";
    let index = -1;
    for (let at = timeline.length - 1; at >= 0 && index === -1; at--) {
      const item = timeline[at];
      if (item?.type !== "user_message") continue;
      const same = message.clientMessageId !== undefined ? item.clientMessageId === message.clientMessageId : item.text === text;
      if (same) index = at;
    }
    if (index === -1) return [];
    const after = timeline
      .slice(index + 1)
      .flatMap((item) => (item.type === "assistant_message" ? [item.text ?? ""] : []))
      .join("");
    return quotesMessage(after, text) ? [] : [text];
  });
}

/** The messages as the reminder quotes them back: each a Markdown quote, apart. */
export function quotedForReminder(messages: readonly string[]): string {
  return messages.map((text) => text.split("\n").map((line) => `> ${line}`.trimEnd()).join("\n")).join("\n\n");
}
