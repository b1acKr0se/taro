import { describe, expect, it } from "vitest";

import type { Board } from "./contracts";
import { withSavedContext } from "./past-context";
import { TicketStatsSchema, type TicketStats } from "./stats";

function past(id: string, used: number | null = null, max: number | null = null) {
  return { id, role: "owner", archivedAt: "2026-01-05T10:00:00.000Z", contextUsedTokens: used, contextMaxTokens: max };
}

function board(cards: { id: string; pastAgents: ReturnType<typeof past>[] }[]): Board {
  return { project: "notes-app", cards } as unknown as Board;
}

function saved(ticket: string, agents: Record<string, { contextTokens: number | null; contextMaxTokens: number | null }>): TicketStats {
  return TicketStatsSchema.parse({
    project: "notes-app",
    ticket,
    agents: Object.fromEntries(Object.entries(agents).map(([agentId, usage]) => [agentId, { agentId, role: "owner", model: null, title: null, ...usage }])),
  });
}

describe("withSavedContext (TR-156)", () => {
  it("gives an archived agent the pair its ticket's stats saved, as Paseo forgets it at the archive", () => {
    const result = withSavedContext(board([{ id: "NA-1", pastAgents: [past("owner-1")] }]), [saved("NA-1", { "owner-1": { contextTokens: 86_000, contextMaxTokens: 200_000 } })]);
    expect(result.cards[0]?.pastAgents[0]).toMatchObject({ contextUsedTokens: 86_000, contextMaxTokens: 200_000 });
  });

  it("keeps Paseo's numbers when it still has both", () => {
    const result = withSavedContext(board([{ id: "NA-1", pastAgents: [past("owner-1", 12_000, 1_000_000)] }]), [saved("NA-1", { "owner-1": { contextTokens: 86_000, contextMaxTokens: 200_000 } })]);
    expect(result.cards[0]?.pastAgents[0]).toMatchObject({ contextUsedTokens: 12_000, contextMaxTokens: 1_000_000 });
  });

  it("replaces a half reading from Paseo with the saved pair, never mixing the two", () => {
    const result = withSavedContext(board([{ id: "NA-1", pastAgents: [past("owner-1", 12_000, null)] }]), [saved("NA-1", { "owner-1": { contextTokens: 86_000, contextMaxTokens: 200_000 } })]);
    expect(result.cards[0]?.pastAgents[0]).toMatchObject({ contextUsedTokens: 86_000, contextMaxTokens: 200_000 });
  });

  it("leaves an agent without a full saved pair as it was: one saved before the window was kept, or never saved", () => {
    const input = board([{ id: "NA-1", pastAgents: [past("older"), past("unsaved")] }]);
    const result = withSavedContext(input, [saved("NA-1", { older: { contextTokens: 90_000, contextMaxTokens: null } })]);
    expect(result).toBe(input);
    expect(result.cards[0]?.pastAgents.map((agent) => [agent.contextUsedTokens, agent.contextMaxTokens])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("reads each agent from its own card's ticket, not another ticket's record of the same id", () => {
    const result = withSavedContext(
      board([
        { id: "NA-1", pastAgents: [past("agent-a")] },
        { id: "NA-2", pastAgents: [] },
      ]),
      [saved("NA-2", { "agent-a": { contextTokens: 50_000, contextMaxTokens: 200_000 } }), saved("NA-1", { "agent-a": { contextTokens: 10_000, contextMaxTokens: 200_000 } })],
    );
    expect(result.cards[0]?.pastAgents[0]).toMatchObject({ contextUsedTokens: 10_000 });
    expect(result.cards[1]?.pastAgents).toEqual([]);
  });

  it("leaves a board with no past agents or no stats untouched", () => {
    const input = board([{ id: "NA-1", pastAgents: [] }]);
    expect(withSavedContext(input, [])).toBe(input);
    expect(withSavedContext(board([]), []).cards).toEqual([]);
  });
});
