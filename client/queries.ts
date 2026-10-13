/** The screen's shared data: the project list and per-project stats, polled, one cache for screen, sidebar and panels. */
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { listProjects, loadStats } from "../shared/contracts";

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

/** A project's per-ticket stats, shared by the board's Done cards and the Stats tab. */
export function useStats(project: string) {
  const load = useRpc(loadStats);
  return useQuery({ queryKey: ["taro", "stats", project] as const, queryFn: () => load({ project }), refetchInterval: 15_000 });
}
