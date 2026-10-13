/**
 * Where an agent's open decisions sit in its conversation (TR-026): no pinned area, each drawn under
 * the message that asked it and answered there. Pure.
 */
import { parseDecisionBlocks } from "../shared/reports";
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

/** How much of a decision card must show for it to count as on screen, in points. */
const VISIBLE_SLACK = 60;

/**
 * Whether the bottom of a row (where its decision cards are drawn) is on screen. `rowTop` and
 * `rowHeight` are in the transcript's content coordinates.
 */
export function rowEndOnScreen(rowTop: number, rowHeight: number, scrollOffset: number, viewportHeight: number): boolean {
  const end = rowTop + rowHeight;
  return end > scrollOffset + VISIBLE_SLACK && end - VISIBLE_SLACK < scrollOffset + viewportHeight;
}

/** The scroll offset that puts a row's end, with its decision cards, at the bottom of the screen. */
export function offsetShowingRowEnd(rowTop: number, rowHeight: number, viewportHeight: number): number {
  return Math.max(0, rowTop + rowHeight - viewportHeight + 16);
}
