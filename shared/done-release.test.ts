import { describe, expect, it } from "vitest";

import { doneTicketOf, planRelease } from "./done-release";

const agent = (id: string, ticket: string | undefined, role: string, workspaceId: string | null, status = "idle") => ({
  id,
  status,
  workspaceId,
  labels: { "taro.project": "demo", "taro.role": role, ...(ticket === undefined ? {} : { "taro.ticket": ticket }) },
});
type Agent = ReturnType<typeof agent>;
const options = (archivedOwnerWorkspaces: string[] = []) => ({
  isMidTurn: (candidate: Agent) => candidate.status === "running" || candidate.status === "initializing",
  managerWorkspaceId: "ws-manager",
  archivedOwnerWorkspaces: new Set(archivedOwnerWorkspaces),
});
const ids = (plan: ReturnType<typeof planRelease<Agent>>) => ({
  archive: plan.archive.map((entry) => `${entry.agent.id}@${entry.ticket}`),
  waiting: plan.waiting.map((entry) => entry.id),
  workspaces: plan.workspaces,
});

describe("doneTicketOf", () => {
  const done = new Set(["DM-1", "DM-2.1"]);
  it("matches the ticket itself and its children, outermost first", () => {
    expect(doneTicketOf("DM-1", done)).toBe("DM-1");
    expect(doneTicketOf("DM-1.3", done)).toBe("DM-1");
    expect(doneTicketOf("DM-1.3.2", done)).toBe("DM-1");
    expect(doneTicketOf("DM-2.1.4", new Set(["DM-2", "DM-2.1"]))).toBe("DM-2");
  });
  it("does not match a parent of a Done child, a prefix that is not a parent, or no label", () => {
    expect(doneTicketOf("DM-2", done)).toBeNull();
    expect(doneTicketOf("DM-10", done)).toBeNull();
    expect(doneTicketOf(undefined, done)).toBeNull();
    expect(doneTicketOf("", done)).toBeNull();
  });
});

describe("planRelease", () => {
  it("releases nothing without Done tickets or agents", () => {
    expect(ids(planRelease(new Set(), [agent("o", "DM-1", "owner", "ws-1")], options()))).toEqual({ archive: [], waiting: [], workspaces: [] });
    expect(ids(planRelease(new Set(["DM-1"]), [], options()))).toEqual({ archive: [], waiting: [], workspaces: [] });
  });

  it("archives an idle owner and its workspace", () => {
    expect(ids(planRelease(new Set(["DM-1"]), [agent("o", "DM-1", "owner", "ws-1")], options()))).toEqual({ archive: ["o@DM-1"], waiting: [], workspaces: ["ws-1"] });
  });

  // The TR-016 / TR-019 case: the owner set Done and was still finishing its last message.
  it("keeps a mid-turn owner waiting, and its workspace with it", () => {
    for (const status of ["running", "initializing"]) {
      expect(ids(planRelease(new Set(["DM-1"]), [agent("o", "DM-1", "owner", "ws-1", status)], options()))).toEqual({ archive: [], waiting: ["o"], workspaces: [] });
    }
  });

  it("archives idle subagents but keeps the workspace while the owner in it is mid-turn", () => {
    const agents = [agent("o", "DM-1", "owner", "ws-1", "running"), agent("r", "DM-1", "reviewer", "ws-1"), agent("i", "DM-1.2", "implementer", "ws-1")];
    expect(ids(planRelease(new Set(["DM-1"]), agents, options()))).toEqual({ archive: ["r@DM-1", "i@DM-1"], waiting: ["o"], workspaces: [] });
  });

  it("archives a last subagent's workspace only when an owner of a Done ticket held it", () => {
    const agents = [agent("r", "DM-1", "reviewer", "ws-1")];
    expect(ids(planRelease(new Set(["DM-1"]), agents, options(["ws-1"])))).toEqual({ archive: ["r@DM-1"], waiting: [], workspaces: ["ws-1"] });
    expect(ids(planRelease(new Set(["DM-1"]), agents, options()))).toEqual({ archive: ["r@DM-1"], waiting: [], workspaces: [] });
  });

  it("never archives the manager's workspace or one another live agent stays in", () => {
    const agents = [agent("o", "DM-1", "owner", "ws-manager"), agent("p", "DM-2", "owner", "ws-2"), agent("q", "DM-3", "owner", "ws-2"), agent("m", undefined, "manager", "ws-manager")];
    expect(ids(planRelease(new Set(["DM-1", "DM-2"]), agents, options()))).toEqual({ archive: ["o@DM-1", "p@DM-2"], waiting: [], workspaces: [] });
  });

  it("leaves agents of open tickets, unlabelled agents and an owner without a workspace's workspace alone", () => {
    const agents = [agent("open", "DM-5", "owner", "ws-5"), agent("m", undefined, "manager", "ws-manager"), agent("o", "DM-1", "owner", null)];
    expect(ids(planRelease(new Set(["DM-1"]), agents, options()))).toEqual({ archive: ["o@DM-1"], waiting: [], workspaces: [] });
  });

  it("lists a workspace once when two owners shared it", () => {
    const agents = [agent("o1", "DM-1", "owner", "ws-1"), agent("o2", "DM-1", "owner", "ws-1")];
    expect(ids(planRelease(new Set(["DM-1"]), agents, options()))).toEqual({ archive: ["o1@DM-1", "o2@DM-1"], waiting: [], workspaces: ["ws-1"] });
  });
});
