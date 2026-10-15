// TR-068: the Ticket tab lists a parent's children with their status, which the store's view gives (TR-081).
// TR-095: it offers Compact for the ticket's owner under the board's old rule.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ticketSections } from "../shared/ticket-summary";
import { projectAgents } from "./agents";
import { loadTicketDetail } from "./board";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { listTickets, viewTicket } from "./tickets";

vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: "/tracker" }) }));
vi.mock("./agents", () => ({ projectAgents: vi.fn(async () => []) }));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn() }));

type Viewed = Awaited<ReturnType<typeof viewTicket>>;

function parent(subtasks: { id: string; title: string; status: string }[], parentTaskId: string | null = null): Viewed {
  return {
    parentTaskId,
    id: "NA-1",
    title: "Notes export",
    status: "In Progress",
    labels: [],
    description: null,
    acceptanceCriteria: [],
    implementationPlan: null,
    implementationNotes: null,
    finalSummary: null,
    dependencies: [],
    subtasks,
  } as unknown as Viewed;
}

beforeEach(() => {
  vi.mocked(listTickets).mockReset();
  vi.mocked(viewTicket).mockReset();
  vi.mocked(projectAgents).mockReset().mockResolvedValue([]);
});

describe("loadTicketDetail children", () => {
  it("gives each child its status, without listing the tracker", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([{ id: "NA-1.01", title: "Export as CSV", status: "Done" }, { id: "NA-1.02", title: "Export as JSON", status: "In Progress" }]));
    const detail = await loadTicketDetail({} as PaseoApi, "notes", "NA-1");
    expect(detail.children).toEqual([
      { id: "NA-1.01", title: "Export as CSV", status: "Done" },
      { id: "NA-1.02", title: "Export as JSON", status: "In Progress" },
    ]);
    const children = ticketSections({ ...detail, plan: null }, []).find((section) => section.key === "children");
    expect(children?.summary).toBe("2 children · 1 done");
    expect(listTickets).not.toHaveBeenCalled();
  });

  it("has no children for a ticket without any", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([]));
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).children).toEqual([]);
  });
});

function ownerAgent(status: string, used: number | null, ticket = "NA-1"): PaseoAgent {
  return { id: "agent-1", status, labels: { "taro.ticket": ticket }, lastUsage: used === null ? null : { contextWindowUsedTokens: used } } as unknown as PaseoAgent;
}

describe("loadTicketDetail Compact", () => {
  it("names an idle owner past 150k", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([]));
    vi.mocked(projectAgents).mockResolvedValue([ownerAgent("idle", 166_000)]);
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).compactOwner).toBe("agent-1");
  });

  it("is null for a running owner, a small context, no usage, no owner, a closed owner or another ticket's owner", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([]));
    for (const agents of [[ownerAgent("running", 200_000)], [ownerAgent("idle", 150_000)], [ownerAgent("idle", null)], [], [ownerAgent("closed", 200_000)], [ownerAgent("idle", 200_000, "NA-2")]]) {
      vi.mocked(projectAgents).mockResolvedValue(agents);
      expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).compactOwner).toBeNull();
    }
  });

  it("is null for a child, whose owner is its parent's", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([], "NA-0"));
    vi.mocked(projectAgents).mockResolvedValue([ownerAgent("idle", 200_000)]);
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).compactOwner).toBeNull();
  });
});
