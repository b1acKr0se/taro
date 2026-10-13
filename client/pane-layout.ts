/**
 * What a project's view draws beside its conversation (TR-018). On a wide screen the board can be
 * hidden: the conversation takes the room, and an open ticket moves from the Chat · Ticket switch
 * to a panel on the right, so the chat and its ticket are read side by side. A phone shows one
 * thing at a time and is unaffected.
 */
export interface ProjectLayout {
  /** The board (or Stats) pane on the right. */
  board: boolean;
  /** The open ticket in its own right-hand panel, instead of a tab in the owner's pane. */
  ticketBeside: boolean;
}

export function projectLayout({ compact, boardHidden, ticketOpen }: { compact: boolean; boardHidden: boolean; ticketOpen: boolean }): ProjectLayout {
  if (compact) return { board: false, ticketBeside: false };
  if (!boardHidden) return { board: true, ticketBeside: false };
  return { board: false, ticketBeside: ticketOpen };
}
