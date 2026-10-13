/** The screen's shared data: the project list, polled, one cache for screen, sidebar and panels. */
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { listProjects } from "../shared/contracts";

export const PROJECTS_KEY = ["taro", "projects"] as const;

export function useProjects() {
  const load = useRpc(listProjects);
  return useQuery({ queryKey: PROJECTS_KEY, queryFn: () => load({}), refetchInterval: 5_000 });
}

export function useRefreshProjects(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: PROJECTS_KEY });
  };
}
