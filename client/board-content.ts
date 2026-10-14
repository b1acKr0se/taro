import type { Board } from "../shared/contracts";

/** What the screen's panes draw from a board: all but its load time and thread count. */
export type BoardContent = Pick<Board, "cards" | "managerDecisions" | "suggestions" | "alerts" | "totals" | "offPage">;

/**
 * The board's `select`: the load time and thread count change on every poll, so a board read whole
 * would redraw every pane each refresh; the parts drawn keep their identity until one changes (TR-069).
 */
export function boardContent(board: Board): BoardContent {
  return { cards: board.cards, managerDecisions: board.managerDecisions, suggestions: board.suggestions, alerts: board.alerts, totals: board.totals, offPage: board.offPage };
}
