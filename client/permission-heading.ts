/**
 * The heading of a card for what an agent asks (`permission-card.tsx`), naming the agent as the user
 * knows it: "TR-072's owner", "TR-072's reviewer", "The Manager" (TR-076), never Taro's internal
 * names for agents.
 */
import { paneAgentJob, type PaneAgentRole } from "./pane-agents";

/** Who asks: the Manager of a project, or an agent of a ticket by its job. */
export type Asker = { kind: "manager" } | { kind: "ticket"; ticket: string; role: PaneAgentRole };

/** What the card is for: a question form, a plan to approve, or a permission. */
export type AskKind = "question" | "plan" | "permission";

export function askerName(asker: Asker): string {
  return asker.kind === "manager" ? "The Manager" : `${asker.ticket}'s ${paneAgentJob(asker.role)}`;
}

export function permissionHeading(asker: Asker, kind: AskKind): string {
  const name = askerName(asker);
  if (kind === "question") return `${name} is asking you`;
  if (kind === "plan") return `${name} has a plan for you to approve`;
  return `${name} is asking permission`;
}
