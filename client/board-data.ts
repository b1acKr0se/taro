/** The board query, shared by the screen's panes. */
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { PagedColumn } from "../shared/board";
import { loadBoard } from "../shared/contracts";
import { boardContent } from "./board-content";
import { addPage, boardPaging, setOpenTicket } from "./board-paging";
import { polled } from "./polling";

export function boardKey(project: string) {
  return ["taro", "board", project] as const;
}

export function useBoard(project: string) {
  const load = useRpc(loadBoard);
  // The pages loaded are read at each fetch, so every pane shares one query and a refresh keeps them (TR-082).
  return useQuery({ queryKey: boardKey(project), queryFn: () => load({ project, ...boardPaging(project) }), ...polled(4_000), select: boardContent });
}

export function useRefreshBoard(project: string): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: boardKey(project) });
  };
}

/** Loads a paged column's next page; resolves once the board holds it. */
export function useLoadMore(project: string): (column: PagedColumn) => Promise<void> {
  const client = useQueryClient();
  return async (column) => {
    addPage(project, column);
    await client.refetchQueries({ queryKey: boardKey(project), exact: true });
  };
}

/** Asks the board for the open ticket's card whatever its page; resolves once the board holds it. */
export function useOpenTicketCard(project: string): (ticket: string | null) => Promise<void> {
  const client = useQueryClient();
  return async (ticket) => {
    if (setOpenTicket(project, ticket) && ticket !== null) await client.refetchQueries({ queryKey: boardKey(project), exact: true });
  };
}
