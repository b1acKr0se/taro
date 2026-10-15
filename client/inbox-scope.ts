/** Which open decisions an Inbox lists. Pure. */
import type { StoredDecision } from "../shared/state";

/** The decisions of the projects an Inbox shows: every project on desktop, the open one on a phone (TR-137). */
export function decisionsOfProjects(decisions: readonly StoredDecision[], projects: ReadonlyArray<{ config: { project: string } }>): StoredDecision[] {
  const names = new Set(projects.map((summary) => summary.config.project));
  return decisions.filter((decision) => names.has(decision.project));
}
