/**
 * The board, assembled on the daemon (spec §5): the tracker's tickets, the
 * project's live agents by label, and the plugin's own state, joined into cards.
 */
import { hostname } from "node:os";

import { boardColumn, complexityOf } from "../shared/board";
import type { Board, Card, TicketDetailView } from "../shared/contracts";
import { TARO_LABELS } from "../shared/project";
import { parseSuggestions, suggestionKey } from "../shared/suggestions";
import { projectAgents } from "./agents";
import { statePath } from "./data-dir";
import { readJsonIfPresent, readTextIfPresent, writeJsonAtomically } from "./files";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { projectPaths } from "./projects";
import { serialized } from "./serialize";
import type { PluginState } from "./state";
import { agentBrief } from "./summaries";
import { latestRecord, listTickets, viewTicket } from "./tickets";

const UNDER_WAY = new Set(["Planning", "In Progress", "Reviewing", "Awaiting acceptance", "Blocked"]);

/** The host an EXECUTION record names, when it names one other than this machine. */
async function ownerHostElsewhere(trackerPath: string, ticketId: string): Promise<string | null> {
  try {
    const detail = await viewTicket(trackerPath, ticketId);
    const record = latestRecord(detail.implementationNotes, ["EXECUTION"]);
    const host = record === null ? null : /\bhost(?:name)?\s*[:=]?\s*([A-Za-z0-9._-]+)/i.exec(record)?.[1] ?? null;
    return host !== null && host !== hostname() ? host : null;
  } catch {
    return null;
  }
}

function newest(agents: readonly PaseoAgent[]): PaseoAgent | null {
  return [...agents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

export async function loadBoard(paseo: PaseoApi, state: PluginState, project: string): Promise<Board> {
  const paths = await projectPaths(project);
  const [tickets, agents, decisions, agentStates] = await Promise.all([
    listTickets(paths.tracker),
    projectAgents(paseo, project),
    state.allDecisions(),
    state.allAgents(),
  ]);

  const byTicket = new Map<string, PaseoAgent[]>();
  for (const agent of agents) {
    const ticket = agent.labels[TARO_LABELS.ticket];
    if (ticket === undefined) continue;
    byTicket.set(ticket, [...(byTicket.get(ticket) ?? []), agent]);
  }
  const openDecisions = decisions.filter((decision) => decision.project === project && decision.status === "open");

  const cards: Card[] = await Promise.all(
    tickets.map(async (ticket) => {
      const ticketAgents = byTicket.get(ticket.id) ?? [];
      const owner = newest(ticketAgents.filter((agent) => agent.labels[TARO_LABELS.role] === "owner" && agent.status !== "closed"));
      const helpers = ticketAgents.filter((agent) => agent.labels[TARO_LABELS.role] === "helper" || agent.labels[TARO_LABELS.role] === "reviewer");
      const ownerState = owner === null ? null : agentStates[owner.id] ?? null;
      const ticketDecisions = openDecisions.filter((decision) => decision.ticket === ticket.id);
      const elsewhere = owner === null && UNDER_WAY.has(ticket.status) ? await ownerHostElsewhere(paths.tracker, ticket.id) : null;
      const children = tickets
        .filter((candidate) => candidate.parentTaskId === ticket.id)
        .map((child) => ({ id: child.id, title: child.title, status: child.status }));
      return {
        id: ticket.id,
        title: ticket.title,
        status: ticket.status,
        column: boardColumn({
          status: ticket.status,
          ownerElsewhere: elsewhere !== null,
          agent: owner === null ? null : { status: owner.status, pendingPermissions: owner.pendingPermissions.length },
          lastStatus: ownerState?.lastStatus?.state ?? null,
          openBlockingDecisions: ticketDecisions.filter((decision) => decision.blocking).length,
          stalledAfterNudge: ownerState?.stalled ?? false,
        }),
        labels: ticket.labels,
        complexity: complexityOf(ticket.labels),
        investigation: ticket.labels.includes("investigation"),
        parent: ticket.parentTaskId,
        children,
        acceptanceDone: ticket.acceptanceCriteriaCompleted,
        acceptanceTotal: ticket.acceptanceCriteriaCount,
        updatedAt: ticket.updatedAt,
        owner: owner === null ? null : agentBrief(owner),
        ownerElsewhere: elsewhere,
        lastStatus: ownerState?.lastStatus ?? null,
        stalled: ownerState?.stalled ?? false,
        decisions: ticketDecisions,
        helpers: helpers.map(agentBrief),
      };
    }),
  );

  return {
    project,
    cards,
    managerDecisions: openDecisions.filter((decision) => decision.ticket === null),
    suggestions: await readSuggestions(project),
    loadedAt: new Date().toISOString(),
  };
}

export async function loadTicketDetail(project: string, ticketId: string): Promise<TicketDetailView> {
  const detail = await viewTicket((await projectPaths(project)).tracker, ticketId);
  return {
    id: detail.id,
    title: detail.title,
    status: detail.status,
    labels: detail.labels,
    description: detail.description,
    acceptanceCriteria: detail.acceptanceCriteria.map((criterion) => ({ index: criterion.index, text: criterion.text, checked: criterion.checked })),
    plan: detail.implementationPlan,
    notes: detail.implementationNotes,
    finalSummary: detail.finalSummary,
    dependencies: detail.dependencies,
    children: detail.subtasks.map((child) => ({ id: child.id, title: child.title, status: child.status ?? null })),
  };
}

function dismissedPath(): string {
  return statePath("suggestions-dismissed.json");
}

async function readDismissed(): Promise<Record<string, string[]>> {
  const raw = await readJsonIfPresent(dismissedPath()).catch(() => null);
  return typeof raw === "object" && raw !== null ? (raw as Record<string, string[]>) : {};
}

export async function readSuggestions(project: string): Promise<{ label: string; prompt: string }[]> {
  const text = (await readTextIfPresent((await projectPaths(project)).suggestions)) ?? "";
  const dismissed = new Set((await readDismissed())[project] ?? []);
  return parseSuggestions(text).filter((suggestion) => !dismissed.has(suggestionKey(suggestion)));
}

export function dismissSuggestion(project: string, label: string, prompt: string): Promise<void> {
  return serialized("suggestions-dismissed", async () => {
    const all = await readDismissed();
    all[project] = [...new Set([...(all[project] ?? []), suggestionKey({ label, prompt })])].slice(-200);
    await writeJsonAtomically(dismissedPath(), all);
  });
}
