import { describe, expect, it } from "vitest";

import type { AgentBrief, Card } from "../shared/contracts";
import type { SubagentRole } from "../shared/project";
import { askedElsewhere, defaultPaneAgent, openingPaneAgent, paneAgentDetail, paneOpening, paneAgentState, paneAgents, roleIcon, taskOfTitle, waitingOn } from "./pane-agents";

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
    createdAt: null,
    turnStartedAt: null,
  };
}

function sub(id: string, title: string | null = null, role: SubagentRole = "implementer"): Card["subagents"][number] {
  return { ...brief(id, title), role };
}

function past(id: string, role: "owner" | SubagentRole, title: string | null = null): Card["pastAgents"][number] {
  return { ...brief(id, title), role, archivedAt: "2026-10-13T15:00:00Z" };
}

function card(parts: Partial<Pick<Card, "owner" | "subagents" | "pastAgents">>): Pick<Card, "owner" | "subagents" | "pastAgents"> {
  return { owner: null, subagents: [], pastAgents: [], ...parts };
}

describe("roleIcon", () => {
  it("draws each job, and a live owner apart from an archived one", () => {
    const roles = [["owner", true], ["owner", false], ["implementer", true], ["reviewer", true], ["researcher", false]] as const;
    expect(roles.map(([role, live]) => roleIcon({ role, live }))).toEqual(["Crown", "UserRound", "Wrench", "ShieldCheck", "Search"]);
  });
});

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
      ["owner-1", "Previous owner", false],
    ]);
    expect(defaultPaneAgent(list)?.id).toBe("owner-2");
  });

  // TR-162: an implementer archived after the owner came before it.
  it("puts the newest past owner first when none is live, before subagents archived after it", () => {
    const list = paneAgents(card({ pastAgents: [past("implementer-1", "implementer"), past("owner-new", "owner"), past("owner-old", "owner")] }));
    expect(list.map((agent) => [agent.id, agent.label])).toEqual([
      ["owner-new", "Owner"],
      ["implementer-1", "Implementer · implemen"],
      ["owner-old", "Previous owner"],
    ]);
    expect(defaultPaneAgent(list)?.id).toBe("owner-new");
  });

  // TR-162: a still-live reviewer came before the archived owner.
  it("puts the archived owner before a live reviewer", () => {
    const list = paneAgents(
      card({ subagents: [sub("reviewer-1", "TR-1 · reviewer: reviewing the branch", "reviewer")], pastAgents: [past("owner-2", "owner"), past("implementer-1", "implementer"), past("owner-1", "owner")] }),
    );
    expect(list.map((agent) => [agent.id, agent.label, agent.live])).toEqual([
      ["owner-2", "Owner", false],
      ["reviewer-1", "Reviewer reviewing the branch", true],
      ["implementer-1", "Implementer · implemen", false],
      ["owner-1", "Previous owner", false],
    ]);
  });

  it("numbers several previous owners by start, oldest first, after the live owner", () => {
    const started = (id: string, createdAt: string | null) => ({ ...past(id, "owner"), createdAt });
    const list = paneAgents(
      card({ owner: brief("owner-4"), subagents: [sub("reviewer-1", null, "reviewer")], pastAgents: [started("owner-3", "2026-10-13T12:00:00Z"), past("researcher-1", "researcher"), started("owner-1", "2026-10-13T08:00:00Z"), { ...started("owner-2", null), archivedAt: "2026-10-13T10:00:00Z" }] }),
    );
    expect(list.map((agent) => [agent.id, agent.label])).toEqual([
      ["owner-4", "Owner"],
      ["reviewer-1", "Reviewer · reviewer"],
      ["owner-3", "Previous owner 3"],
      ["researcher-1", "Researcher · research"],
      ["owner-1", "Previous owner 1"],
      // No known start: its archive time (10:00) places it between the two.
      ["owner-2", "Previous owner 2"],
    ]);
  });

  it("has no default when only subagents are known", () => {
    expect(defaultPaneAgent(paneAgents(card({ subagents: [sub("implementer-1")] })))).toBeNull();
  });

  it("labels subagents by their job and task, or by a short id without a task", () => {
    const list = paneAgents(
      card({
        subagents: [sub("0123456789abcdef", "TR-016 · helper: Building the chat spacing"), sub("fedcba9876543210"), sub("1111111122", "TR-016 · researcher: reading the Paseo docs", "researcher")],
        pastAgents: [past("aaaaaaaa-bbbb", "reviewer", "checking the whole branch"), past("cccccccc-dddd", "reviewer", "  "), past("eeeeeeee-ffff", "implementer")],
      }),
    );
    expect(list.map((agent) => [agent.label, agent.role, agent.live])).toEqual([
      ["Implementer building the chat spacing", "implementer", true],
      ["Implementer · fedcba98", "implementer", true],
      ["Researcher reading the Paseo docs", "researcher", true],
      ["Reviewer checking the whole branch", "reviewer", false],
      ["Reviewer · cccccccc", "reviewer", false],
      ["Implementer · eeeeeeee", "implementer", false],
    ]);
    expect(list.some((agent) => /helper/i.test(agent.label))).toBe(false);
  });

  it("takes the task out of a title, without the ticket id or the role", () => {
    expect(taskOfTitle("TR-016 · implementer: board panels")).toBe("board panels");
    // Titles from before TR-017 named the role `helper`.
    expect(taskOfTitle("TR-016 · helper: board panels")).toBe("board panels");
    expect(taskOfTitle("TR-016.2 · Reviewer: TR-016 diff")).toBe("TR-016 diff");
    expect(taskOfTitle("Chat spacing")).toBe("Chat spacing");
    expect(taskOfTitle("  ")).toBe("");
    expect(taskOfTitle(null)).toBe("");
  });

  it("lists an agent both live and archived once, as live", () => {
    const list = paneAgents(card({ owner: brief("owner-1"), subagents: [sub("implementer-1")], pastAgents: [past("owner-1", "owner"), past("implementer-1", "implementer")] }));
    expect(list.map((agent) => [agent.id, agent.live])).toEqual([
      ["owner-1", true],
      ["implementer-1", true],
    ]);
  });

  it("keeps the brief without the archive fields", () => {
    const [agent] = paneAgents(card({ pastAgents: [past("owner-1", "owner")] }));
    expect(agent?.brief).toEqual(brief("owner-1"));
  });
});

const NOW = Date.parse("2026-10-13T15:30:00Z");

describe("subagent state", () => {
  it("is running for a live running agent, timed from its start until now", () => {
    const [agent] = paneAgents(card({ subagents: [{ ...sub("a", "TR-1 · implementer: building the board"), status: "running", model: "claude-sonnet-5-5", createdAt: "2026-10-13T15:04:00Z" }] }));
    expect(agent === undefined ? null : paneAgentState(agent, NOW)).toEqual({ state: "running", elapsedMs: 26 * 60_000 });
    expect(agent === undefined ? null : paneAgentDetail(agent, NOW)).toBe("running · claude-sonnet-5-5 · 26m");
  });

  it("is done for an archived agent, timed until it was archived", () => {
    const [agent] = paneAgents(card({ pastAgents: [{ ...past("r", "reviewer"), createdAt: "2026-10-13T14:48:00Z" }] }));
    expect(agent === undefined ? null : paneAgentState(agent, NOW)).toEqual({ state: "done", elapsedMs: 12 * 60_000 });
    expect(agent === undefined ? null : paneAgentDetail(agent, NOW)).toBe("done · claude · 12m");
  });

  it("reads idle and error from Paseo's status, and leaves the time out when the start is unknown", () => {
    const list = paneAgents(card({ subagents: [{ ...sub("i"), status: "idle" }, { ...sub("e"), status: "error" }, { ...sub("n"), status: "initializing" }] }));
    expect(list.map((agent) => paneAgentState(agent, NOW))).toEqual([
      { state: "idle", elapsedMs: null },
      { state: "error", elapsedMs: null },
      { state: "running", elapsedMs: null },
    ]);
  });
});

describe("waitingOn", () => {
  it("is null when no subagent runs", () => {
    expect(waitingOn({ subagents: [] }, NOW)).toBeNull();
    expect(waitingOn({ subagents: [{ ...sub("i"), status: "idle" }] }, NOW)).toBeNull();
  });

  it("says what the newest running subagent is doing, in its title's words, and counts the others", () => {
    const subagents = [
      { ...sub("old", "TR-1 · implementer: writing the parser"), status: "running", createdAt: "2026-10-13T14:30:00Z" },
      { ...sub("new", "TR-1 · implementer: building the board columns, cards and Ticket tab"), status: "running", createdAt: "2026-10-13T15:04:00Z" },
      { ...sub("idle", "TR-1 · implementer: reading the spec"), status: "idle", createdAt: "2026-10-13T15:20:00Z" },
    ];
    expect(waitingOn({ subagents }, NOW)).toEqual({ text: "Implementer building the board columns, cards and Ticket tab", running: "26m", more: 1 });
  });

  it("names a reviewer as a reviewer, and drops a missing task or time", () => {
    expect(waitingOn({ subagents: [{ ...sub("r", "TR-1 · reviewer: Checking the whole branch", "reviewer"), status: "running", createdAt: "2026-10-13T15:26:00Z" }] }, NOW)).toEqual({
      text: "Reviewer checking the whole branch",
      running: "4m",
      more: 0,
    });
    expect(waitingOn({ subagents: [{ ...sub("x"), status: "running" }] }, NOW)).toEqual({ text: "Implementer", running: null, more: 0 });
  });
});

// TR-096: a researcher's permission waited unseen; its Allow and Deny are in its own chat.
describe("openingPaneAgent and askedElsewhere", () => {
  const owner = brief("owner-1");
  const listed = paneAgents(card({ owner, subagents: [sub("researcher-1", "NA-1 · researcher: read the logs", "researcher")], pastAgents: [past("old-1", "reviewer")] }));
  const ask = { title: "Allow Bash?", detail: "ls", id: "p1", agentId: "researcher-1", role: "researcher" as const, workspaceId: null, count: 1 };
  const question = { key: "owner-1:naming", id: "naming", agentId: "owner-1", question: "Call it drafts?", blocking: false } as unknown as Card["decisions"][number];

  it("opens on the live agent asking permission, else the owner", () => {
    expect(openingPaneAgent(listed, "researcher-1")?.id).toBe("researcher-1");
    expect(openingPaneAgent(listed, "owner-1")?.id).toBe("owner-1");
    expect(openingPaneAgent(listed, null)?.id).toBe("owner-1");
    expect(openingPaneAgent(listed, "old-1")?.id).toBe("owner-1");
    expect(openingPaneAgent([], "researcher-1")).toBeNull();
  });

  it("points the owner's chat at a subagent's permission before any question", () => {
    expect(askedElsewhere({ permission: ask, decisions: [] }, "owner-1", listed)).toMatchObject({ agent: { id: "researcher-1" }, text: "Allow Bash?", permission: true, blocking: true });
    expect(askedElsewhere({ permission: null, decisions: [] }, "owner-1", listed)).toBeNull();
  });

  it("says nothing of the permission in the asker's own chat, and points it at another agent's question", () => {
    expect(askedElsewhere({ permission: ask, decisions: [] }, "researcher-1", listed)).toBeNull();
    expect(askedElsewhere({ permission: ask, decisions: [question] }, "researcher-1", listed)).toMatchObject({ agent: { id: "owner-1" }, text: "Call it drafts?", permission: false, blocking: false });
  });
});

// TR-096 review: Review on the ticket already open stayed on the owner's chat.
describe("paneOpening", () => {
  it("takes the agent asking at each new opening, the ticket already open too", () => {
    const first = paneOpening(null, "NA-1#1", "owner-1");
    expect(first).toEqual({ key: "NA-1#1", asker: "owner-1" });
    expect(paneOpening(first, "NA-1#2", "researcher-1")).toEqual({ key: "NA-1#2", asker: "researcher-1" });
  });

  it("keeps its asker within one opening once the request clears or another asks", () => {
    const opened = paneOpening(null, "NA-1#1", "researcher-1");
    expect(paneOpening(opened, "NA-1#1", null)).toBe(opened);
    expect(paneOpening(opened, "NA-1#1", "reviewer-1")).toBe(opened);
  });
});
