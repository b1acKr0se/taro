import { describe, expect, it } from "vitest";

import type { AgentBrief, Card } from "../shared/contracts";
import { defaultPaneAgent, paneAgents } from "./pane-agents";

function brief(id: string, title: string | null = null): AgentBrief {
  return {
    id,
    title,
    status: "idle",
    provider: "claude",
    model: null,
    workspaceId: null,
    pendingPermissions: 0,
    updatedAt: "2026-10-13T14:00:00Z",
    contextUsedTokens: null,
    contextMaxTokens: null,
  };
}

function past(id: string, role: "owner" | "helper" | "reviewer", title: string | null = null): Card["pastAgents"][number] {
  return { ...brief(id, title), role, archivedAt: "2026-10-13T15:00:00Z" };
}

function card(parts: Partial<Pick<Card, "owner" | "helpers" | "pastAgents">>): Pick<Card, "owner" | "helpers" | "pastAgents"> {
  return { owner: null, helpers: [], pastAgents: [], ...parts };
}

describe("paneAgents", () => {
  it("is empty for a ticket that never had an agent", () => {
    const list = paneAgents(card({}));
    expect(list).toEqual([]);
    expect(defaultPaneAgent(list)).toBeNull();
  });

  it("shows a live owner alone", () => {
    const list = paneAgents(card({ owner: brief("owner-1") }));
    expect(list.map(({ id, label, role, live }) => ({ id, label, role, live }))).toEqual([{ id: "owner-1", label: "Owner", role: "owner", live: true }]);
    expect(defaultPaneAgent(list)?.id).toBe("owner-1");
  });

  it("puts the live owner before earlier owners and picks it", () => {
    const list = paneAgents(card({ owner: brief("owner-2"), pastAgents: [past("owner-1", "owner")] }));
    expect(list.map((agent) => [agent.id, agent.label, agent.live])).toEqual([
      ["owner-2", "Owner", true],
      ["owner-1", "Owner (earlier)", false],
    ]);
    expect(defaultPaneAgent(list)?.id).toBe("owner-2");
  });

  it("picks the newest past owner when none is live", () => {
    const list = paneAgents(card({ pastAgents: [past("helper-1", "helper"), past("owner-new", "owner"), past("owner-old", "owner")] }));
    expect(list.map((agent) => [agent.id, agent.label])).toEqual([
      ["helper-1", "Helper · helper-1"],
      ["owner-new", "Owner"],
      ["owner-old", "Owner (earlier)"],
    ]);
    expect(defaultPaneAgent(list)?.id).toBe("owner-new");
  });

  it("has no default when only helpers are known", () => {
    expect(defaultPaneAgent(paneAgents(card({ helpers: [brief("helper-1")] })))).toBeNull();
  });

  it("labels helpers and reviewers by title, or by a short id without one", () => {
    const list = paneAgents(
      card({
        helpers: [brief("0123456789abcdef", "Chat spacing"), brief("fedcba9876543210")],
        pastAgents: [past("aaaaaaaa-bbbb", "reviewer", "Review TR-016"), past("cccccccc-dddd", "reviewer", "  "), past("eeeeeeee-ffff", "helper")],
      }),
    );
    expect(list.map((agent) => [agent.label, agent.role, agent.live])).toEqual([
      ["Helper · Chat spacing", "helper", true],
      ["Helper · fedcba98", "helper", true],
      ["Reviewer · Review TR-016", "reviewer", false],
      ["Reviewer · cccccccc", "reviewer", false],
      ["Helper · eeeeeeee", "helper", false],
    ]);
  });

  it("lists an agent both live and archived once, as live", () => {
    const list = paneAgents(card({ owner: brief("owner-1"), helpers: [brief("helper-1")], pastAgents: [past("owner-1", "owner"), past("helper-1", "helper")] }));
    expect(list.map((agent) => [agent.id, agent.live])).toEqual([
      ["owner-1", true],
      ["helper-1", true],
    ]);
  });

  it("keeps the brief without the archive fields", () => {
    const [agent] = paneAgents(card({ pastAgents: [past("owner-1", "owner")] }));
    expect(agent?.brief).toEqual(brief("owner-1"));
  });
});
