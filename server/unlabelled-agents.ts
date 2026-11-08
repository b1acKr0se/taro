/** Finding agents an owner started without Taro's labels, and telling the owner and the user (TR-259). */
import { TARO_LABELS } from "../shared/project";
import { alreadyRecorded, PARENT_AGENT_LABEL, unlabelledAlerts, unlabelledChildren, unlabelledRecord, type UnlabelledAgent } from "../shared/unlabelled-agents";
import { listTaroAgents, projectAgents } from "./agents";
import type { PaseoApi } from "./host-types";
import { TEMPLATES, message, skillDirectory } from "./package-files";
import { projectPaths } from "./projects";
import { sendFromPlugin } from "./send";
import { appendTicketNote, viewTicket } from "./tickets";
import type { BoardAlert } from "../shared/recovery";

export interface UnlabelledAgents {
  /** One pass over the projects' owners: warns about each new agent and returns whether any alert changed. */
  sweep(paseo: PaseoApi, projects: readonly string[]): Promise<boolean>;
  /** The alerts for a project's board and Inbox, as the last sweep found them. */
  alerts(project: string): BoardAlert[];
}

export function createUnlabelledAgents(): UnlabelledAgents {
  const found = new Map<string, UnlabelledAgent[]>();
  const told = new Set<string>();

  /** Whether the owner has the message: sent now, or recorded as sent by an earlier sweep. */
  async function warn(paseo: PaseoApi, project: string, agent: UnlabelledAgent): Promise<boolean> {
    const tracker = (await projectPaths(project)).tracker;
    const detail = await viewTicket(tracker, agent.ticket);
    if (alreadyRecorded(detail.implementationNotes, agent.id)) return true;
    // Told before noted: a failed send leaves no note, so the next sweep tries again.
    await sendFromPlugin(
      paseo,
      agent.ownerId,
      await message(TEMPLATES.unlabelledAgent, { agent: agent.title ?? agent.id, id: agent.id, ticket: agent.ticket, skill: await skillDirectory() }),
    );
    await appendTicketNote(tracker, agent.ticket, unlabelledRecord(`${new Date().toISOString().slice(0, 16)}Z`, agent));
    console.log(`[taro] ${agent.id} was started by ${agent.ownerId} without Taro's labels: told the owner and noted ${agent.ticket}`);
    return true;
  }

  const alertsKey = (project: string): string => unlabelledAlerts(found.get(project) ?? [], told).map((alert) => alert.text).join("\n");

  return {
    async sweep(paseo, projects) {
      let changed = false;
      for (const project of projects) {
        const agents: UnlabelledAgent[] = [];
        for (const owner of await projectAgents(paseo, project, "owner")) {
          const ticket = owner.labels[TARO_LABELS.ticket];
          if (ticket === undefined || owner.status === "closed") continue;
          const children = await listTaroAgents(paseo, { [PARENT_AGENT_LABEL]: owner.id });
          agents.push(...unlabelledChildren({ id: owner.id, ticket }, children));
        }
        for (const agent of agents) {
          const sent = await warn(paseo, project, agent).catch((error: unknown) => {
            console.error(`[taro] warning about unlabelled ${agent.id}:`, error);
            return false;
          });
          if (sent) told.add(agent.id);
        }
        const before = alertsKey(project);
        found.set(project, agents);
        if (before !== alertsKey(project)) changed = true;
      }
      return changed;
    },
    alerts: (project) => unlabelledAlerts(found.get(project) ?? [], told),
  };
}
