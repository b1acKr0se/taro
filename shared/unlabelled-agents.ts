/**
 * Agents an owner started without Taro's labels (TR-259): the board lists subagents by label, so such
 * an agent is neither listed nor supervised, and a permission ask from it shows no card. Paseo's plugin
 * API cannot label an agent after it starts, so Taro finds it by the parent link Paseo records for any
 * agent started from an owner's shell, and tells the owner and the user.
 */
import type { BoardAlert } from "./recovery";
import { TARO_LABELS } from "./project";

/** The label Paseo puts on an agent started by another agent, whatever flags the command used. */
export const PARENT_AGENT_LABEL = "paseo.parent-agent-id";

export interface ChildAgent {
  id: string;
  title: string | null;
  status: string;
  archivedAt?: string | null | undefined;
  labels: Readonly<Record<string, string>>;
}

export interface UnlabelledAgent {
  id: string;
  title: string | null;
  ticket: string;
  ownerId: string;
}

/** The live children of an owner that lack any of Taro's three labels. */
export function unlabelledChildren(owner: { id: string; ticket: string }, children: readonly ChildAgent[]): UnlabelledAgent[] {
  return children.flatMap((child) => {
    const live = child.status !== "closed" && (child.archivedAt === null || child.archivedAt === undefined);
    // The board needs all three: a child with only some of them is listed nowhere and has no role or ticket.
    const labelled = [TARO_LABELS.project, TARO_LABELS.role, TARO_LABELS.ticket].every((label) => (child.labels[label] ?? "") !== "");
    return live && !labelled && child.id !== owner.id ? [{ id: child.id, title: child.title, ticket: owner.ticket, ownerId: owner.id }] : [];
  });
}

function nameOf(agent: UnlabelledAgent): string {
  return agent.title === null || agent.title === "" ? agent.id.slice(0, 8) : `${agent.title} (${agent.id.slice(0, 8)})`;
}

/** One alert for the user per agent, which comes down when the agent is archived; `told` holds the agents whose owner has the message. */
export function unlabelledAlerts(agents: readonly UnlabelledAgent[], told: ReadonlySet<string>): BoardAlert[] {
  return agents.map((agent) => ({
    id: `unlabelled-${agent.id}`,
    tickets: [],
    text: `${nameOf(agent)} was started in ${agent.ticket}'s workspace without Taro's labels, so the board does not list it, Taro does not supervise it and a permission ask from it would show no card. ${told.has(agent.id) ? `${agent.ticket}'s owner has been told to archive it and start it again with the labels.` : `Taro could not reach ${agent.ticket}'s owner yet and tries again every minute.`}`,
  }));
}

/** The UNLABELLED record for the ticket's notes; the agent comes first, as a collapsed row shows only its start. */
export function unlabelledRecord(at: string, agent: UnlabelledAgent): string {
  return `UNLABELLED ${at} — ${nameOf(agent)} started by the owner without the taro.project, taro.role and taro.ticket labels (TR-259); it is not listed or supervised. The owner was told to archive it and start it again with them (skill/reference/paseo.md).`;
}

/** Whether the ticket's notes already record this agent, so a reload or the next sweep does not repeat the warning. */
export function alreadyRecorded(notes: string | null, agentId: string): boolean {
  return notes !== null && notes.split("\n").some((line) => line.startsWith("UNLABELLED ") && line.includes(agentId.slice(0, 8)));
}
