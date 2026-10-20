/**
 * A reply drawn as it is written (TR-144). Paseo streams a Claude reply as many small
 * `assistant_message` pieces (one every 70 ms or so), each with its place in the timeline (`seq`) and
 * the timeline's `epoch`. The chat adds the pieces that follow its last read straight after it, as
 * entries of their own: `transcriptRows` joins them into the reply by the same rule Paseo merges by.
 * The read stays the truth; a piece out of order, from another epoch, or after a step the read lacks
 * (a tool call) waits for the next read.
 */
import type { TurnBoundary } from "../shared/pending-sends";
import type { TimelineEntry } from "./transcript-rows";

export interface StreamedPiece {
  epoch: string;
  seq: number;
  entry: TimelineEntry;
}

/** Pieces kept between reads; a stream that outruns its reads by more starts over at the next one. */
export const MAX_PIECES = 2000;

/** The piece a stream event carries, or null for every other event. */
export function streamedPiece(event: unknown): StreamedPiece | null {
  if (typeof event !== "object" || event === null) return null;
  const { event: inner, seq, epoch, timestamp } = event as { event?: unknown; seq?: unknown; epoch?: unknown; timestamp?: unknown };
  if (typeof seq !== "number" || typeof epoch !== "string" || typeof inner !== "object" || inner === null) return null;
  const { type, item, provider, turnId } = inner as { type?: unknown; item?: unknown; provider?: unknown; turnId?: unknown };
  if (type !== "timeline" || typeof item !== "object" || item === null) return null;
  const message = item as { type?: unknown; text?: unknown };
  if (message.type !== "assistant_message" || typeof message.text !== "string") return null;
  const entry = {
    provider: typeof provider === "string" ? provider : "",
    item,
    ...(typeof turnId === "string" ? { turnId } : {}),
    timestamp: typeof timestamp === "string" ? timestamp : "",
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    collapsed: [],
  } as unknown as TimelineEntry;
  return { epoch, seq, entry };
}

/** A turn starting or ending, from a stream event (TR-201); null for every other event. */
export function turnBoundary(event: unknown): TurnBoundary | null {
  if (typeof event !== "object" || event === null) return null;
  const inner: unknown = Reflect.get(event, "event");
  const type: unknown = typeof inner === "object" && inner !== null ? Reflect.get(inner, "type") : null;
  if (type === "turn_started") return "started";
  if (type === "turn_completed" || type === "turn_failed" || type === "turn_canceled") return "ended";
  return null;
}

/** The read's entries with the pieces that continue it, in order and without a gap, after them. */
export function withStreamed(entries: readonly TimelineEntry[], epoch: string | null, pieces: readonly StreamedPiece[]): readonly TimelineEntry[] {
  const last = entries[entries.length - 1];
  if (epoch === null || last === undefined || pieces.length === 0) return entries;
  const following = pieces.filter((piece) => piece.epoch === epoch && piece.seq > last.seqEnd).sort((left, right) => left.seq - right.seq);
  const added: TimelineEntry[] = [];
  let next = last.seqEnd + 1;
  following.forEach((piece) => {
    if (piece.seq === next) {
      added.push(piece.entry);
      next += 1;
    }
  });
  return added.length === 0 ? entries : [...entries, ...added];
}

/**
 * What to draw when pieces arrive between reads: the read with them after it, or null to leave the
 * chat as it is — before the first read (the pane shows the cached conversation then, and a blank
 * read would wipe it) or when no piece continues the read.
 */
export function drawnWithPieces(read: readonly TimelineEntry[], epoch: string | null, pieces: readonly StreamedPiece[]): readonly TimelineEntry[] | null {
  if (epoch === null) return null;
  const drawn = withStreamed(read, epoch, pieces);
  return drawn === read ? null : drawn;
}

/** The pieces a new read does not hold yet, to add after it; the rest are dropped. */
export function unreadPieces(pieces: readonly StreamedPiece[], epoch: string | null, entries: readonly TimelineEntry[]): StreamedPiece[] {
  const lastSeq = entries[entries.length - 1]?.seqEnd;
  if (epoch === null || lastSeq === undefined) return [];
  return pieces.filter((piece) => piece.epoch === epoch && piece.seq > lastSeq);
}
