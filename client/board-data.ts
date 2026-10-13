/** The board query, shared by the screen's panes. */
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { loadBoard } from "../shared/contracts";

export function boardKey(project: string) {
  return ["taro", "board", project] as const;
}

export function useBoard(project: string) {
  const load = useRpc(loadBoard);
  return useQuery({ queryKey: boardKey(project), queryFn: () => load({ project }), refetchInterval: 4_000 });
}

export function useRefreshBoard(project: string): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: boardKey(project) });
  };
}
