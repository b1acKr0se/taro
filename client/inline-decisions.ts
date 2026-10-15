/**
 * Where an agent's open decisions sit in its conversation (TR-026): no pinned area, each drawn under
 * the message that asked it and answered there. Pure.
 */
import { parseDecisionBlocks, parseStatusLine } from "../shared/reports";
import type { StoredDecision } from "../shared/state";
import { walkOrder } from "./walk-order";

export interface DecisionPlaces {
  /** Row key → the open decisions drawn under that message, in the order it asked them. */
  byRow: Map<string, StoredDecision[]>;
  /** Open decisions no loaded message asks (the message is older than the timeline): drawn at its end. */
  unplaced: StoredDecision[];
  /** The decision to bring into view and jump to: the first in Walk me through order. */
  first: StoredDecision | null;
}

/**
 * A decision asked again is drawn under its newest asking only, where the agent's latest words about
 * it are. A block that withdraws a decision is not an asking.
 */
export function placeDecisions(rows: readonly { key: string; text: string }[], open: readonly StoredDecision[]): DecisionPlaces {
  const byRow = new Map<string, StoredDecision[]>();
  const placed = new Set<string>();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const here: StoredDecision[] = [];
    // Marked placed as found, so a block repeated within one message is drawn once.
    parseDecisionBlocks(row.text)
      .filter((block) => !block.withdrawn)
      .forEach((block) => {
        const decision = open.find((candidate) => candidate.id === block.id && !placed.has(candidate.key));
        if (decision === undefined) return;
        placed.add(decision.key);
        here.push(decision);
      });
    if (here.length > 0) byRow.set(row.key, here);
  }
  const unplaced = open.filter((decision) => !placed.has(decision.key));
  return { byRow, unplaced, first: walkOrder(open)[0] ?? null };
}

/**
 * The message the acceptance card is drawn under (TR-131): the newest whose status line is `done:`,
 * where the owner delivered. One card per chat, so an older delivery reads as plain text. Null when
 * no loaded message delivered (it is older than the timeline): the card then sits at the end.
 */
export function deliveryRowKey(rows: readonly { key: string; text: string }[]): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row !== undefined && parseStatusLine(row.text)?.state === "done") return row.key;
  }
  return null;
}

/** How much of a card must show for it to count as on screen, in points. */
const VISIBLE_SLACK = 60;

/** Room kept under a revealed card: the jump-to-end button floats over the transcript's foot. */
const BOTTOM_ROOM = 56;

/** Room kept above a card shown from its top. */
const TOP_ROOM = 8;

/**
 * Whether enough of a card (a decision or the acceptance card) is on screen to see it. `cardTop`
 * and `cardHeight` are in the transcript's content coordinates.
 */
export function cardOnScreen(cardTop: number, cardHeight: number, scrollOffset: number, viewportHeight: number): boolean {
  const visible = Math.min(cardTop + cardHeight, scrollOffset + viewportHeight) - Math.max(cardTop, scrollOffset);
  return visible >= Math.min(VISIBLE_SLACK, cardHeight);
}

/** Whether a card fits on the screen whole, with room around it. */
export function cardFits(cardHeight: number, viewportHeight: number): boolean {
  return cardHeight + BOTTOM_ROOM + TOP_ROOM <= viewportHeight;
}

/**
 * The scroll offset that shows a card: its end above the jump-to-end button when it fits on the
 * screen, else its top, where its heading is (the rest is read by scrolling down).
 */
export function offsetShowingCard(cardTop: number, cardHeight: number, viewportHeight: number): number {
  if (!cardFits(cardHeight, viewportHeight)) return Math.max(0, cardTop - TOP_ROOM);
  return Math.max(0, cardTop + cardHeight - viewportHeight + BOTTOM_ROOM);
}
