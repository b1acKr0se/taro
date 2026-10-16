/**
 * Earlier pages of a chat (TR-169). The chat re-reads only the timeline's tail, so the entries
 * before it are read a page at a time as the reader scrolls up (`refetch({ direction: "before" })`)
 * and kept here in front of the tail. Every tail read after that is joined to them: the entries the
 * tail has moved past were in the read before it, so they stay too, and the conversation stays whole
 * from the first page read to the newest entry.
 */

/** What every timeline entry has: its place in the timeline. */
export interface Placed {
  seqStart: number;
  seqEnd: number;
}

/** Entries before the tail, all from one epoch; `hasOlder` when the daemon has more before them. */
export interface OlderPages<Entry extends Placed> {
  epoch: string;
  entries: readonly Entry[];
  hasOlder: boolean;
}

/** A timeline read: the tail, or a page before it. */
export interface Read<Entry extends Placed> {
  epoch: string;
  entries: readonly Entry[];
  hasOlder: boolean;
}

/** Entries that end before `seq`. */
function endingBefore<Entry extends Placed>(entries: readonly Entry[], seq: number): Entry[] {
  return entries.filter((entry) => entry.seqEnd < seq);
}

/**
 * The older pages after a new tail read, given the tail read before it. Null when there are none to
 * keep: none were read, the timeline was replaced (a new epoch), or the tail moved past the whole
 * last read (more arrived between two reads than a tail holds), leaving a hole the chat cannot show.
 */
export function joinTail<Entry extends Placed>(older: OlderPages<Entry> | null, previous: readonly Entry[], tail: Read<Entry>): OlderPages<Entry> | null {
  if (older === null || tail.epoch !== older.epoch) return null;
  const first = tail.entries[0];
  if (first === undefined) return older;
  // The tail shares no entry with the last read: what lay between them may never have been read.
  const previousLast = previous[previous.length - 1];
  if (previousLast !== undefined && previousLast.seqEnd < first.seqStart) return null;
  const kept = endingBefore(older.entries, first.seqStart);
  const lastKept = kept[kept.length - 1]?.seqEnd ?? -Infinity;
  const slidOut = endingBefore(previous, first.seqStart).filter((entry) => entry.seqStart > lastKept);
  return { epoch: older.epoch, entries: [...kept, ...slidOut], hasOlder: older.hasOlder };
}

/**
 * The older pages with a page read before them. `first` is the first entry drawn now (the older
 * pages' first, else the tail's). A page from another epoch is dropped: the timeline was replaced
 * while it was read. A page that adds nothing ends the paging, so a cursor the daemon does not move
 * back cannot read the same page forever.
 */
export function addOlderPage<Entry extends Placed>(older: OlderPages<Entry> | null, first: Placed | undefined, epoch: string, page: Read<Entry>): OlderPages<Entry> | null {
  if (page.epoch !== epoch) return older;
  const before = first === undefined ? page.entries : endingBefore(page.entries, first.seqStart);
  const entries = older?.epoch === epoch ? older.entries : [];
  return { epoch, entries: [...before, ...entries], hasOlder: before.length > 0 && page.hasOlder };
}

/** What the chat draws: the older pages, then the tail. */
export function withOlder<Entry extends Placed>(older: OlderPages<Entry> | null, tail: readonly Entry[]): readonly Entry[] {
  return older === null || older.entries.length === 0 ? tail : [...older.entries, ...tail];
}
