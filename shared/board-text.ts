/**
 * The board as `taro board` prints it, for a session in Paseo or outside it: tickets by status, each with
 * its open cards and recorded agents from the ticket file, and, read-only, what the Paseo plugin last
 * stored (owners' open questions, agents). Paseo's state is read by hand (no zod) and only as a snapshot:
 * whether an agent still lives is known to the daemon alone, so its entries say when the file was written.
 *
 * Pure and import-free beyond its siblings, for the `taro` command under plain Node type stripping:
 * erasable TypeScript only, `.ts` import extensions.
 */
import { TICKET_STATUSES, type TicketStatus } from "./ticket-format.ts";
import type { TrackerAgent, TrackerCard } from "./tracker-cards.ts";

/** An open card or a running recorded agent older than this is marked stale. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface BoardCard extends TrackerCard {
  /** `tracker:<project>/<ticket>:<cardId>`, or null when the tracker's project is not known. */
  key: string | null;
  answerCommand: string;
  stale: boolean;
}

export interface BoardAgent extends TrackerAgent {
  stale: boolean;
}

export interface BoardTicket {
  id: string;
  title: string;
  status: TicketStatus;
  cards: BoardCard[];
  agents: BoardAgent[];
}

export interface PaseoCard {
  key: string;
  ticket: string | null;
  id: string;
  question: string;
  options: string[];
  agentId: string;
  agentRole: string;
  askedAt: string;
  answerCommand: string;
}

export interface PaseoAgent {
  id: string;
  role: string;
  ticket: string | null;
  title: string | null;
  /** The last status line's state (working, blocked, done…), or null before one. */
  state: string | null;
  text: string | null;
  at: string | null;
}

export interface PaseoView {
  /** When the newest state file read was written. */
  asOf: string;
  cards: PaseoCard[];
  agents: PaseoAgent[];
}

export interface Board {
  tickets: BoardTicket[];
  paseo: PaseoView | null;
}

/** A state file as read: its JSON (null when absent) and when it was written, or why it could not be read. */
export type StateFile = { kind: "absent" } | { kind: "unreadable"; reason: string } | { kind: "read"; value: unknown; writtenAt: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function olderThan(time: string, now: number): boolean {
  const parsed = Date.parse(time);
  return Number.isFinite(parsed) && now - parsed > STALE_AFTER_MS;
}

export function trackerCardKey(project: string | null, ticket: string, cardId: string): string | null {
  return project === null ? null : `tracker:${project}/${ticket}:${cardId}`;
}

export function trackerAnswerCommand(ticket: string, card: Pick<TrackerCard, "id" | "options">): string {
  return `taro card answer ${ticket} ${card.id} ${card.options.length === 0 ? "--text <words>" : "--label <option> [--text <words>]"}`;
}

function paseoAnswerCommand(key: string, options: readonly string[]): string {
  return `taro decision answer ${key} ${options.length === 0 ? "--text <words>" : "--label <option> [--text <words>]"}`;
}

/** The open, shown questions of the project in Paseo's `decisions.json` (`{decisions: [...]}`); anything else is skipped. */
export function paseoCardsOf(value: unknown, project: string): PaseoCard[] {
  const decisions = isRecord(value) && Array.isArray(value.decisions) ? value.decisions : [];
  return decisions.flatMap((decision): PaseoCard[] => {
    if (!isRecord(decision) || decision.status !== "open" || decision.held === true || decision.project !== project) return [];
    const key = text(decision.key);
    const id = text(decision.id);
    const question = text(decision.question);
    if (key === null || id === null || question === null) return [];
    const options = (Array.isArray(decision.options) ? decision.options : []).flatMap((option) => (isRecord(option) && typeof option.label === "string" ? [option.label] : []));
    return [
      {
        key,
        ticket: text(decision.ticket),
        id,
        question,
        options,
        agentId: text(decision.agentId) ?? "",
        agentRole: text(decision.agentRole) ?? "",
        askedAt: text(decision.askedAt) ?? "",
        answerCommand: paseoAnswerCommand(key, options),
      },
    ];
  });
}

/** The project's agents in Paseo's `agents.json` (`{agents: {<id>: {...}}}`), as the plugin last knew them. */
export function paseoAgentsOf(value: unknown, project: string): PaseoAgent[] {
  const agents = isRecord(value) && isRecord(value.agents) ? value.agents : {};
  return Object.entries(agents).flatMap(([id, agent]): PaseoAgent[] => {
    if (!isRecord(agent) || agent.project !== project) return [];
    const status = isRecord(agent.lastStatus) ? agent.lastStatus : null;
    return [{ id, role: text(agent.role) ?? "agent", ticket: text(agent.ticket), title: text(agent.title), state: text(status?.state), text: text(status?.text), at: text(status?.at) }];
  });
}

export interface BoardInput {
  project: string | null;
  tickets: Array<{ id: string; title: string; status: TicketStatus; cards: TrackerCard[]; agents: TrackerAgent[] }>;
  decisions: StateFile;
  agents: StateFile;
  now: number;
}

/** The board, and one line about Paseo's state when it is absent or could not be read. */
export function buildBoard(input: BoardInput): { board: Board; paseoNote: string | null } {
  const tickets: BoardTicket[] = input.tickets.map((ticket) => ({
    id: ticket.id,
    title: ticket.title,
    status: ticket.status,
    cards: ticket.cards
      .filter((card) => card.status === "open")
      .map((card) => ({ ...card, key: trackerCardKey(input.project, ticket.id, card.id), answerCommand: trackerAnswerCommand(ticket.id, card), stale: olderThan(card.askedAt, input.now) })),
    agents: ticket.agents.map((agent) => ({ ...agent, stale: agent.state === "running" && olderThan(agent.startedAt, input.now) })),
  }));
  const unreadable = [input.decisions, input.agents].flatMap((file) => (file.kind === "unreadable" ? [file.reason] : []));
  const read = [input.decisions, input.agents].filter((file): file is Extract<StateFile, { kind: "read" }> => file.kind === "read");
  let paseoNote: string | null = null;
  if (unreadable.length > 0) paseoNote = `Paseo state could not be read (${unreadable.join("; ")}): ${read.length === 0 ? "showing the tracker only" : "showing what could"}.`;
  else if (read.length === 0) paseoNote = "No Paseo state (the plugin's decisions.json and agents.json): showing the tracker only.";
  else if (input.project === null) paseoNote = "Paseo state is kept per project, and none was named: pass --project <name> to see it.";
  if (read.length === 0 || input.project === null) return { board: { tickets, paseo: null }, paseoNote };
  // A Paseo card with the ticket and id of an open tracker card is hidden: the tracker's is the one answered.
  const trackerOpen = new Set(tickets.flatMap((ticket) => ticket.cards.map((card) => `${ticket.id}\n${card.id}`)));
  const project = input.project;
  const cards = input.decisions.kind === "read" ? paseoCardsOf(input.decisions.value, project).filter((card) => card.ticket === null || !trackerOpen.has(`${card.ticket}\n${card.id}`)) : [];
  const agents = input.agents.kind === "read" ? paseoAgentsOf(input.agents.value, project) : [];
  const asOf = read.map((file) => file.writtenAt).sort().at(-1) as string;
  return { board: { tickets, paseo: { asOf, cards, agents } }, paseoNote };
}

export interface BoardTextOptions {
  project: string | null;
  trackerPath: string;
  /** When each Paseo state file was written, for its entries' marks. */
  decisionsAsOf: string | null;
  agentsAsOf: string | null;
  paseoNote: string | null;
  now: number;
}

function stale(flag: boolean): string {
  return flag ? " [stale]" : "";
}

/** The board as plain text. Done and Cancelled list only tickets that still carry something open. */
export function boardText(board: Board, options: BoardTextOptions): string {
  const lines = [`Board of ${options.project ?? "the tracker"} at ${options.trackerPath}, ${new Date(options.now).toISOString()}`];
  if (options.paseoNote !== null) lines.push(options.paseoNote);
  const viaPaseo = (asOf: string | null): string => `via paseo, as of ${asOf ?? "unknown"}`;
  const paseoCards = board.paseo?.cards ?? [];
  const paseoAgents = board.paseo?.agents ?? [];
  const cardLines = (indent: string, cards: readonly BoardCard[], fromPaseo: readonly PaseoCard[]): string[] => [
    ...cards.flatMap((card) => [`${indent}card ${card.id}${stale(card.stale)}: ${card.question}`, `${indent}  answer: ${card.answerCommand}`]),
    ...fromPaseo.flatMap((card) => [`${indent}card ${card.id} (${viaPaseo(options.decisionsAsOf)}): ${card.question}`, `${indent}  answer: ${card.answerCommand}`]),
  ];
  const agentLines = (indent: string, agents: readonly BoardAgent[], fromPaseo: readonly PaseoAgent[]): string[] => [
    ...agents.map((agent) => `${indent}agent ${agent.name} (${agent.job}, ${agent.state}, ${agent.host})${stale(agent.stale)}${agent.task === "" ? "" : `: ${agent.task}`}`),
    ...fromPaseo.map((agent) => {
      const status = [agent.state ?? "", agent.text ?? ""].filter((part) => part !== "").join(" — ");
      return `${indent}agent ${agent.id} (${agent.role}, ${viaPaseo(options.agentsAsOf)})${status === "" ? "" : `: ${status}`}`;
    }),
  ];
  if (board.tickets.length === 0) lines.push("", "No tickets.");
  const known = new Set(board.tickets.map((ticket) => ticket.id));
  for (const status of TICKET_STATUSES) {
    const inStatus = board.tickets.filter((ticket) => ticket.status === status);
    if (inStatus.length === 0) continue;
    lines.push("", `${status} (${inStatus.length})`);
    const closed = status === "Done" || status === "Cancelled";
    for (const ticket of inStatus) {
      const ticketPaseoCards = paseoCards.filter((card) => card.ticket === ticket.id);
      const ticketPaseoAgents = paseoAgents.filter((agent) => agent.ticket === ticket.id);
      const running = ticket.agents.filter((agent) => agent.state === "running");
      if (closed && ticket.cards.length === 0 && running.length === 0 && ticketPaseoCards.length === 0) continue;
      lines.push(`  ${ticket.id} ${ticket.title}`, ...cardLines("    ", ticket.cards, ticketPaseoCards), ...agentLines("    ", closed ? running : ticket.agents, closed ? [] : ticketPaseoAgents));
    }
  }
  const elsewhereCards = paseoCards.filter((card) => card.ticket === null || !known.has(card.ticket));
  const elsewhereAgents = paseoAgents.filter((agent) => agent.ticket === null || !known.has(agent.ticket));
  if (elsewhereCards.length > 0 || elsewhereAgents.length > 0) {
    lines.push("", "Not on a ticket here");
    lines.push(...cardLines("  ", [], elsewhereCards), ...agentLines("  ", [], elsewhereAgents));
  }
  return `${lines.join("\n")}\n`;
}
