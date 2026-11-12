/**
 * A run whose owner ended "blocked:" and stayed there has nothing left to do: the plugin keeps the last
 * status line in its agents state file, so the harness ends the run instead of waiting out its time cap.
 * Plain Node, erasable TypeScript.
 */

/** How long a blocked status line must stand, so an owner that unblocks itself or is nudged is left alone. */
export const BLOCKED_GRACE_MS = 10 * 60_000;

/** The owner's blocked status line once it has stood for the grace period, else null; `agentsFile` is the parsed state/agents.json. */
export function ownerBlockedLine(agentsFile: unknown, ownerId: string, now: number, graceMs = BLOCKED_GRACE_MS): string | null {
  const agents = (agentsFile as { agents?: Record<string, { lastStatus?: { state?: string; text?: string; at?: string } | null }> } | null)?.agents;
  const last = agents?.[ownerId]?.lastStatus;
  if (last === undefined || last === null || last.state !== "blocked" || typeof last.text !== "string" || typeof last.at !== "string") return null;
  const at = Date.parse(last.at);
  if (!Number.isFinite(at) || now - at < graceMs) return null;
  return last.text;
}
