// TR-068: the Ticket tab lists a parent's children with their status, which the store's view gives (TR-081).
// TR-095: it offers Compact for the ticket's owner under the board's old rule.
// TR-153: it says whether that owner is mid-turn, which holds a delivery's acceptance back.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ticketSections } from "../shared/ticket-summary";
import { projectAgents } from "./agents";
import { loadTicketDetail } from "./board";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { listTickets, viewTicket } from "./tickets";

vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: "/tracker" }) }));
vi.mock("./agents", async (original) => ({ ...(await original<typeof import("./agents")>()), projectAgents: vi.fn(async () => []) }));
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
      { id: "NA-1.01", title: "Export as CSV", status: "Done", evidence: null },
      { id: "NA-1.02", title: "Export as JSON", status: "In Progress", evidence: null },
    ]);
    const children = ticketSections({ ...detail, plan: null }, []).find((section) => section.key === "children");
    expect(children?.summary).toBe("2 children · 1 done");
    expect(listTickets).not.toHaveBeenCalled();
  });

  // TR-187: each child's EVIDENCE comes from its own ticket file, read when the parent loads; the parent holds no copy.
  it("gives each child the EVIDENCE record of its own ticket, null where it has none or cannot be read", async () => {
    const tickets: Record<string, Viewed> = {
      "NA-1": parent([
        { id: "NA-1.01", title: "Export as CSV", status: "Done" },
        { id: "NA-1.02", title: "Export as JSON", status: "Done" },
        { id: "NA-1.03", title: "Export as PDF", status: "Done" },
      ]),
      "NA-1.01": {
        ...parent([], "NA-1"),
        id: "NA-1.01",
        status: "Done",
        implementationNotes: "EVIDENCE 2026-10-18T07:16Z\ncheck: npm test (notes-api @5605098) — 82 passing\nreview: independent review, 0 open findings\nscreenshots: none — API only",
      } as Viewed,
      "NA-1.02": { ...parent([], "NA-1"), id: "NA-1.02", status: "Done", implementationNotes: "MILESTONE 2026-10-18T07:00Z — built" } as Viewed,
    };
    vi.mocked(viewTicket).mockImplementation(async (_tracker, id) => {
      const found = tickets[id];
      if (found === undefined) throw new Error(`${id} not found`);
      return found;
    });
    const detail = await loadTicketDetail({} as PaseoApi, "notes", "NA-1");
    const [csv, json, pdf] = detail.children;
    expect(csv?.evidence).toMatchObject({ checks: [{ command: "npm test (notes-api @5605098)", result: "82 passing" }], review: "independent review, 0 open findings", screenshotsNone: "API only" });
    expect(json?.evidence).toBeNull();
    expect(pdf?.evidence).toBeNull();
    expect(detail.evidence).toBeNull();
    expect(ticketSections({ ...detail, plan: null }, []).find((section) => section.key === "evidence")?.summary).toBe("1 of 3 children · 1 check");
  });

  it("has no children for a ticket without any", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([]));
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).children).toEqual([]);
  });
});

function ownerAgent(status: string, used: number | null, ticket = "NA-1", id = "agent-1", updatedAt = "2026-01-01T12:00:00Z"): PaseoAgent {
  return { id, status, updatedAt, labels: { "taro.ticket": ticket, "taro.role": "owner" }, lastUsage: used === null ? null : { contextWindowUsedTokens: used } } as unknown as PaseoAgent;
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

  it("acts on the newest live owner, the one the board shows, not the first listed", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([]));
    vi.mocked(projectAgents).mockResolvedValue([ownerAgent("idle", 200_000, "NA-1", "agent-old", "2026-01-01T10:00:00Z"), ownerAgent("idle", 180_000, "NA-1", "agent-new", "2026-01-01T12:00:00Z")]);
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).compactOwner).toBe("agent-new");
    vi.mocked(projectAgents).mockResolvedValue([ownerAgent("idle", 200_000, "NA-1", "agent-old", "2026-01-01T10:00:00Z"), ownerAgent("running", 180_000, "NA-1", "agent-new", "2026-01-01T12:00:00Z")]);
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).compactOwner).toBeNull();
  });

  it("is null for a child, whose owner is its parent's", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([], "NA-0"));
    vi.mocked(projectAgents).mockResolvedValue([ownerAgent("idle", 200_000)]);
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).compactOwner).toBeNull();
  });
});

describe("loadTicketDetail ownerRunning", () => {
  it("is true only while the ticket's newest live owner is mid-turn", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([]));
    for (const [status, running] of [["running", true], ["initializing", true], ["idle", false], ["error", false], ["closed", false]] as const) {
      vi.mocked(projectAgents).mockResolvedValue([ownerAgent(status, null)]);
      expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).ownerRunning).toBe(running);
    }
    for (const agents of [[], [ownerAgent("running", null, "NA-2")]]) {
      vi.mocked(projectAgents).mockResolvedValue(agents);
      expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).ownerRunning).toBe(false);
    }
  });

  it("is false when the agents cannot be listed", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([]));
    vi.mocked(projectAgents).mockRejectedValue(new Error("daemon away"));
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).ownerRunning).toBe(false);
  });
});
