/**
 * What the user does from the Taro screen: answer a decision, accept or
 * request changes, nudge, compact or relaunch an owner (decisions 28, 30, 34).
 * Plus releasing a Done ticket's agents and workspaces (TR-024) and the manager's wake-up for
 * tickets whose dependencies cleared.
 */
import { randomUUID } from "node:crypto";

import { doneTicketOf, planRelease } from "../shared/done-release";
import { executionWorkspace, pullRequestMergeInstruction } from "../shared/execution";
import { TARO_LABELS, TICKET_STATUSES } from "../shared/project";
import { fetchLiveAgent, isAgentGone, isMidTurn, listTaroAgents, projectAgents, projectArchivedAgents } from "./agents";
import { taroEnvironment } from "./environment";
import type { PaseoApi } from "./host-types";
import { bypassModeId } from "./models";
import { TEMPLATES, message, skillDirectory } from "./package-files";
import { listProjectConfigs, projectPaths, requireProjectConfig } from "./projects";
import { sendFromPlugin, sendWithoutInterrupting } from "./send";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import { identityFromLabels, type Supervisor } from "./supervision";
import { appendTicketNote, listTickets, viewTicket } from "./tickets";
import type { Stats } from "./stats";
import type { TrackerWatch } from "./tracker-watch";

export class Actions {
  /** Last seen status per project and ticket, to notice transitions to Done. */
  private readonly lastStatuses = new Map<string, Map<string, string>>();
  /** The release running per project, so two never archive the same agents at once. */
  private readonly releasing = new Map<string, Promise<void>>();
  /** Agents already archived here: Paseo may still list one for a moment after archiving it. */
  private readonly released = new Set<string>();

  constructor(
    private readonly state: PluginState,
    private readonly supervisor: Supervisor,
    private readonly trackers: TrackerWatch,
    private readonly stats: Stats,
    private readonly recovery: Recovery,
  ) {}

  async answerDecision(paseo: PaseoApi, key: string, label: string | null, text: string, from: "screen" | "tab" = "screen"): Promise<void> {
    const decision = await this.state.decision(key);
    if (decision === null) throw new Error("That decision is no longer open.");
    // Withdrawal is final, so only Paseo's own word that the agent is gone counts, not a failed lookup.
    if (await isAgentGone(paseo, decision.agentId)) {
      await this.supervisor.withdrawDecisionsOf(decision.agentId);
      throw new Error("The agent that asked this is archived or gone, so nothing was sent; its open questions are withdrawn.");
    }
    const option = label === null ? null : decision.options.find((candidate) => candidate.label === label) ?? null;
    const words = (option?.prompt ?? text).trim();
    if (words === "") throw new Error("Type an answer or press an option.");
    // Tagged as the plugin's, so this answer closes only its own decision, not the agent's others.
    await sendFromPlugin(paseo, decision.agentId, await message(TEMPLATES.answer, { text: words }));
    const at = new Date().toISOString();
    await this.state.updateDecisions((decisions) => {
      const stored = decisions.find((candidate) => candidate.key === key);
      if (stored !== undefined) {
        stored.status = "answered";
        stored.answer = { text: words, label: option?.label ?? null, at };
      }
    });
    if (decision.ticket !== null) {
      const paths = await projectPaths(decision.project);
      await appendTicketNote(paths.tracker, decision.ticket, `ANSWER ${at} — ${decision.id}: "${decision.question}" → ${option === null ? `"${words}"` : `${option.label} ("${words}")`} (the user, from ${from === "tab" ? "the agent's tab" : "the Taro screen"})`).catch(
        (error: unknown) => console.warn(`[taro] could not record the answer on ${decision.ticket}: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
  }

  async tellAgent(paseo: PaseoApi, agentId: string, text: string): Promise<void> {
    const words = text.trim();
    if (words === "") throw new Error("Say something first.");
    if ((await fetchLiveAgent(paseo, agentId)) === null) throw new Error("That agent is no longer running.");
    await sendWithoutInterrupting(paseo, agentId, words);
  }

  async nudge(paseo: PaseoApi, agentId: string): Promise<void> {
    if ((await fetchLiveAgent(paseo, agentId)) === null) throw new Error("That agent is no longer running.");
    await sendFromPlugin(paseo, agentId, await message(TEMPLATES.nudge));
    const record = await this.state.agent(agentId);
    if (record !== null) {
      await this.state.updateAgent(agentId, () => record, (next) => {
        next.stallCount = 0;
        next.stalled = false;
      });
    }
  }

  async compact(paseo: PaseoApi, agentId: string): Promise<void> {
    const agent = await fetchLiveAgent(paseo, agentId);
    if (agent === null) throw new Error("That agent is no longer running.");
    if (isMidTurn(agent)) throw new Error("It is in the middle of a turn. Compact it once it is idle.");
    const identity = identityFromLabels(agent.labels, agent.title ?? null);
    if (identity === null) throw new Error("That is not a Taro agent.");
    await this.supervisor.startCompaction(paseo, agentId, identity, agent.lastUsage?.contextWindowUsedTokens ?? null);
  }

  private async owners(paseo: PaseoApi, project: string, ticket: string) {
    return listTaroAgents(paseo, { [TARO_LABELS.project]: project, [TARO_LABELS.role]: "owner", [TARO_LABELS.ticket]: ticket });
  }

  private async requireOwner(paseo: PaseoApi, project: string, ticket: string) {
    const owner = (await this.owners(paseo, project, ticket)).filter((agent) => agent.status !== "closed").sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (owner === undefined) throw new Error(`${ticket} has no live owner. Relaunch it from its card.`);
    return owner;
  }

  async accept(paseo: PaseoApi, project: string, ticket: string): Promise<void> {
    const config = await requireProjectConfig(project);
    const owner = await this.requireOwner(paseo, project, ticket);
    const detail = await viewTicket((await projectPaths(project)).tracker, ticket);
    const investigation = detail.labels.includes("investigation");
    let mergeInstruction: string;
    if (investigation) mergeInstruction = "Record ACCEPTANCE with my words and set the ticket Done.";
    else if (!config.acceptAlsoMerges) mergeInstruction = "Do not merge; record ACCEPTANCE with my words and set the ticket Done.";
    else if (config.delivery === "pull-request")
      mergeInstruction = pullRequestMergeInstruction(detail.implementationNotes, detail.finalSummary);
    else
      mergeInstruction = `Fast-forward ${config.baseBranch} to your branch in the main checkout (${config.repoPath}), only if it fast-forwards cleanly; then record ACCEPTANCE and set the ticket Done.`;
    await sendWithoutInterrupting(paseo, owner.id, await message(TEMPLATES.accept, { ticket, mergeInstruction }));
  }

  async requestChanges(paseo: PaseoApi, project: string, ticket: string, text: string): Promise<void> {
    const owner = await this.requireOwner(paseo, project, ticket);
    await sendWithoutInterrupting(paseo, owner.id, await message(TEMPLATES.requestChanges, { ticket, text: text.trim() }));
    const paths = await projectPaths(project);
    await appendTicketNote(paths.tracker, ticket, `CHANGES-REQUESTED ${new Date().toISOString()} — the user: "${text.trim()}"`).catch(() => undefined);
  }

  /** A fresh owner in the same workspace, from the ticket's latest handoff or milestone (decision 30). */
  async relaunchOwner(paseo: PaseoApi, project: string, ticket: string): Promise<string> {
    const config = await requireProjectConfig(project);
    const paths = await projectPaths(project);
    const previous = (await this.owners(paseo, project, ticket)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
    let workspaceId = previous?.workspaceId ?? null;
    if (workspaceId === null) {
      const detail = await viewTicket(paths.tracker, ticket);
      workspaceId = executionWorkspace(detail.implementationNotes);
    }
    if (workspaceId === null) throw new Error(`Cannot tell which workspace ${ticket} used; its EXECUTION record names none.`);
    if (previous !== null && isMidTurn(previous)) throw new Error("Its owner is running; nudge or interrupt it instead.");
    if (previous !== null) {
      await paseo.agents.ref(previous.id).archive().catch(() => undefined);
      // The archive hook does this too; done here as well so the new owner never appears beside the old questions.
      await this.supervisor.withdrawDecisionsOf(previous.id);
    }

    const detail = await viewTicket(paths.tracker, ticket);
    const agentId = randomUUID();
    const modeId = await bypassModeId(paseo, config.owner.model);
    await paseo.workspaces.ref(workspaceId).agents.create({
      agentId,
      config: {
        provider: config.owner.model,
        ...(modeId === null ? {} : { modeId }),
        ...(config.owner.thinking === "" ? {} : { thinkingOptionId: config.owner.thinking }),
      },
      title: `${ticket} · ${detail.title}`,
      labels: { [TARO_LABELS.project]: project, [TARO_LABELS.role]: "owner", [TARO_LABELS.ticket]: ticket },
      env: await taroEnvironment(project, paths.tracker),
      prompt: await message(TEMPLATES.relaunchOwner, {
        ticket,
        project,
        skill: await skillDirectory(),
        tracker: paths.tracker,
        agentId,
        workspaceId,
        previousAgentId: previous?.id ?? "(none)",
      }),
    });
    if (previous !== null) await this.state.forgetAgent(previous.id);
    return agentId;
  }

  /** Records every project's ticket statuses at start, so the first change after a reload is seen as one. */
  async primeStatuses(): Promise<void> {
    for (const config of await listProjectConfigs()) {
      if (this.lastStatuses.has(config.project)) continue;
      const tickets = await listTickets((await projectPaths(config.project)).tracker).catch(() => null);
      if (tickets === null) continue;
      this.lastStatuses.set(config.project, new Map(tickets.map((ticket) => [ticket.id, ticket.status])));
      // Questions left open on tickets that finished while the plugin was not watching are moot.
      const finished = new Set(tickets.filter((ticket) => ticket.status === "Done" || ticket.status === "Cancelled").map((ticket) => ticket.id));
      await this.state.updateDecisions((decisions) => {
        for (const decision of decisions) {
          if (decision.project === config.project && decision.status === "open" && decision.ticket !== null && finished.has(decision.ticket)) decision.status = "withdrawn";
        }
      });
    }
  }

  /** Called after every tracker commit: releases Done tickets' agents and wakes the manager for cleared dependencies. */
  async onTrackerChanged(paseo: PaseoApi, project: string): Promise<void> {
    const paths = await projectPaths(project);
    const tickets = await listTickets(paths.tracker);
    const previous = this.lastStatuses.get(project) ?? new Map<string, string>();
    this.lastStatuses.set(project, new Map(tickets.map((ticket) => [ticket.id, ticket.status])));
    const at = new Date().toISOString();
    for (const ticket of tickets) {
      const before = previous.get(ticket.id) ?? null;
      if (before !== ticket.status) await this.stats.transition(project, ticket.id, ticket.title, before, ticket.status, at);
    }
    const done = tickets.filter((ticket) => ticket.status === "Done" && previous.get(ticket.id) !== "Done");
    // Every Done ticket, not only the new ones: a transition missed during a reload still releases its agents.
    await this.releaseDoneTickets(paseo, project, done.map((ticket) => ticket.id));
    for (const ticket of done) {
      await this.wakeManagerForDependents(paseo, project, ticket.id, tickets.filter((candidate) => candidate.status !== "Done" && candidate.status !== "Cancelled").map((candidate) => candidate.id));
    }
  }

  /** An agent's turn ended: if its ticket is Done (it was mid-turn when Done landed), release it now. */
  async onAgentTurnEnded(paseo: PaseoApi, agentId: string): Promise<void> {
    const agent = await fetchLiveAgent(paseo, agentId);
    const project = agent?.labels[TARO_LABELS.project];
    if (agent === null || project === undefined) return;
    const statuses = this.lastStatuses.get(project);
    if (statuses === undefined) return;
    const done = new Set([...statuses].filter(([, status]) => status === "Done").map(([ticket]) => ticket));
    if (doneTicketOf(agent.labels[TARO_LABELS.ticket], done) !== null) await this.releaseDoneTickets(paseo, project, []);
  }

  /** After a start: releases agents left behind by Done tickets while the plugin was not watching. */
  async releaseAfterStart(paseo: PaseoApi): Promise<void> {
    await this.primeStatuses();
    for (const config of await listProjectConfigs()) {
      if (!this.lastStatuses.has(config.project)) continue;
      await this.releaseDoneTickets(paseo, config.project, []).catch((error: unknown) => {
        console.error(`[taro] releasing ${config.project}'s Done tickets after start:`, error);
      });
    }
  }

  /**
   * Archives the idle agents of every Done ticket, and their owners' workspaces once empty; an agent
   * mid-turn waits for its turn end (TR-024). `newlyDone` tickets have their open questions withdrawn
   * even when no agent is left. Queued per project, since a turn end and a commit may arrive together.
   */
  private releaseDoneTickets(paseo: PaseoApi, project: string, newlyDone: readonly string[]): Promise<void> {
    const run = (this.releasing.get(project) ?? Promise.resolve()).then(() => this.release(paseo, project, newlyDone));
    this.releasing.set(project, run.catch(() => undefined));
    return run;
  }

  private async release(paseo: PaseoApi, project: string, newlyDone: readonly string[]): Promise<void> {
    const statuses = this.lastStatuses.get(project) ?? new Map<string, string>();
    const done = new Set([...statuses].filter(([, status]) => status === "Done").map(([ticket]) => ticket));
    if (done.size === 0) return;
    const agents = (await projectAgents(paseo, project)).filter((agent) => !this.released.has(agent.id));
    const config = await requireProjectConfig(project);
    const planWith = (archivedOwnerWorkspaces: ReadonlySet<string>) => planRelease(done, agents, { isMidTurn, managerWorkspaceId: config.managerWorkspaceId, archivedOwnerWorkspaces });
    let plan = planWith(new Set());
    // Past owners' workspaces matter only when a subagent outlived its owner; asked for only then.
    if (plan.archive.some((entry) => entry.agent.labels[TARO_LABELS.role] !== "owner")) {
      const pastOwners = (await projectArchivedAgents(paseo, project).catch(() => [])).filter(
        (agent) => agent.labels[TARO_LABELS.role] === "owner" && doneTicketOf(agent.labels[TARO_LABELS.ticket], done) !== null,
      );
      plan = planWith(new Set(pastOwners.flatMap((agent) => (agent.workspaceId ? [agent.workspaceId] : []))));
    }

    let archivedAgents = 0;
    for (const { agent, ticket } of plan.archive) {
      const usage = agent.lastUsage;
      const statsTicket = agent.labels[TARO_LABELS.ticket] ?? ticket;
      for (const target of new Set([statsTicket, ticket])) {
        await this.stats.agentFinal(project, target, agent.id, usage?.totalCostUsd ?? null, usage?.contextWindowUsedTokens ?? null).catch(() => undefined);
      }
      if (!(await paseo.agents.ref(agent.id).archive().then(() => true, () => false))) continue;
      archivedAgents += 1;
      this.released.add(agent.id);
      await this.state.forgetAgent(agent.id);
    }
    // Paseo archives a workspace with every agent in it: keep one where any agent still lives (the
    // user's own, without Taro labels, or one whose archive just failed and is retried next time).
    const occupied =
      plan.workspaces.length === 0
        ? new Set<string>()
        : await listTaroAgents(paseo, {}).then(
            (all) => new Set(all.filter((agent) => !this.released.has(agent.id)).flatMap((agent) => (agent.workspaceId ? [agent.workspaceId] : []))),
            () => new Set(plan.workspaces),
          );
    let archivedWorkspaces = 0;
    for (const workspaceId of plan.workspaces.filter((candidate) => !occupied.has(candidate))) {
      await paseo.workspaces.archive(workspaceId).then(
        () => {
          archivedWorkspaces += 1;
        },
        (error: unknown) => console.warn(`[taro] could not archive workspace ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
    // Questions about a finished ticket are moot.
    const finished = new Set([...newlyDone, ...plan.archive.map((entry) => entry.ticket), ...plan.waiting.flatMap((agent) => doneTicketOf(agent.labels[TARO_LABELS.ticket], done) ?? [])]);
    if (finished.size > 0) {
      await this.state.updateDecisions((decisions) => {
        for (const decision of decisions) {
          if (decision.project === project && decision.status === "open" && decision.ticket !== null && doneTicketOf(decision.ticket, finished) !== null) decision.status = "withdrawn";
        }
      });
    }
    if (plan.archive.length > 0 || newlyDone.length > 0) {
      const tickets = [...new Set([...newlyDone, ...plan.archive.map((entry) => entry.ticket)])].join(", ");
      const failed = plan.archive.length - archivedAgents;
      const kept = plan.workspaces.filter((candidate) => occupied.has(candidate)).length;
      console.log(
        `[taro] ${project}: ${tickets}: archived ${archivedAgents} agents and ${archivedWorkspaces} workspaces` +
          (failed > 0 ? `; ${failed} failed to archive, retried on the next release` : "") +
          (kept > 0 ? `; kept ${kept} workspaces another agent still uses` : "") +
          `; ${plan.waiting.length} mid-turn, archived when their turn ends`,
      );
    }
  }

  private async wakeManagerForDependents(paseo: PaseoApi, project: string, ticket: string, openTickets: readonly string[]): Promise<void> {
    const paths = await projectPaths(project);
    const dependents: string[] = [];
    for (const id of openTickets) {
      const detail = await viewTicket(paths.tracker, id).catch(() => null);
      if (detail !== null && detail.dependencies.includes(ticket)) dependents.push(id);
    }
    const tickets = await listTickets(paths.tracker);
    const queued = tickets.filter((candidate) => candidate.status === "Backlog" && candidate.parentTaskId === null).map((candidate) => candidate.id);
    if (dependents.length === 0 && queued.length === 0) return;
    const config = await requireProjectConfig(project);
    const manager = await fetchLiveAgent(paseo, config.managerAgentId);
    if (manager === null) return;
    // Held while threads are short (TR-012): a free owner slot is no reason to start one then.
    await this.recovery.tellManagerWhenHeadroom(paseo, project, manager.id, await message(TEMPLATES.dependencyCleared, { ticket, dependents: dependents.length === 0 ? "none" : dependents.join(", "), queued: queued.length === 0 ? "none" : queued.join(", ") }));
  }

  /** Statuses this plugin knows; used to sanity-check a ticket a user moved by hand. */
  static readonly statuses = TICKET_STATUSES;

  /** Commits now (after the plugin wrote to the tracker itself). */
  async commit(project: string): Promise<void> {
    await this.trackers.commit(project);
  }
}
