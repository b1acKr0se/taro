/**
 * An archived agent's context usage (TR-156). Paseo forgets an agent's usage when it archives it, so
 * the board's past agents take the reading Taro's stats saved at the agent's last turn end or archive.
 */
import type { Board } from "./contracts";
import type { TicketStats } from "./stats";

/** The board with each past agent missing its context usage given the pair its ticket's stats saved, when both halves are there. */
export function withSavedContext(board: Board, stats: readonly TicketStats[]): Board {
  const saved = new Map(stats.map((ticket) => [ticket.ticket, ticket.agents]));
  let changed = false;
  const cards = board.cards.map((card) => {
    if (card.pastAgents.length === 0) return card;
    const pastAgents = card.pastAgents.map((agent) => {
      if (agent.contextUsedTokens !== null && agent.contextMaxTokens !== null) return agent;
      const record = saved.get(card.id)?.[agent.id];
      if (record === undefined || record.contextTokens === null || record.contextMaxTokens === null) return agent;
      changed = true;
      return { ...agent, contextUsedTokens: record.contextTokens, contextMaxTokens: record.contextMaxTokens };
    });
    return { ...card, pastAgents };
  });
  return changed ? { ...board, cards } : board;
}
