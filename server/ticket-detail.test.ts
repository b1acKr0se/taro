// TR-068: the Ticket tab lists a parent's children with their status, which the store's view gives (TR-081).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ticketSections } from "../shared/ticket-summary";
import { loadTicketDetail } from "./board";
import type { PaseoApi } from "./host-types";
import { listTickets, viewTicket } from "./tickets";

vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: "/tracker" }) }));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn() }));

type Viewed = Awaited<ReturnType<typeof viewTicket>>;

function parent(subtasks: { id: string; title: string; status: string }[]): Viewed {
  return {
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
