// TR-068: Backlog's task view lists a parent's children without their status; the Ticket tab reads it from the ticket list.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ticketSections } from "../shared/ticket-summary";
import { loadTicketDetail } from "./board";
import { listTickets, viewTicket } from "./tickets";

vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: "/tracker" }) }));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn() }));

type Listed = Awaited<ReturnType<typeof listTickets>>;
type Viewed = Awaited<ReturnType<typeof viewTicket>>;

function listed(id: string, status: string, parentTaskId: string | null = null) {
  return { id, title: `Title of ${id}`, status, labels: [], parentTaskId };
}

function parent(subtasks: { id: string; title: string; status?: string }[]): Viewed {
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
  it("gives each child its status from the ticket list, as the task view omits it", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([{ id: "NA-1.01", title: "Export as CSV" }, { id: "NA-1.02", title: "Export as JSON" }]));
    vi.mocked(listTickets).mockResolvedValue([listed("NA-1", "In Progress"), listed("NA-1.01", "Done", "NA-1"), listed("NA-1.02", "In Progress", "NA-1")] as unknown as Listed);
    const detail = await loadTicketDetail("notes", "NA-1");
    expect(detail.children).toEqual([
      { id: "NA-1.01", title: "Export as CSV", status: "Done" },
      { id: "NA-1.02", title: "Export as JSON", status: "In Progress" },
    ]);
    const children = ticketSections({ ...detail, plan: null }, []).find((section) => section.key === "children");
    expect(children?.summary).toBe("2 children · 1 done");
  });

  it("keeps a status the task view gives, for a child the list does not have", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([{ id: "NA-1.01", title: "Export as CSV", status: "Done" }]));
    vi.mocked(listTickets).mockResolvedValue([listed("NA-1", "In Progress")] as unknown as Listed);
    expect((await loadTicketDetail("notes", "NA-1")).children).toEqual([{ id: "NA-1.01", title: "Export as CSV", status: "Done" }]);
  });

  it("does not list the tracker for a ticket without children", async () => {
    vi.mocked(viewTicket).mockResolvedValue(parent([]));
    expect((await loadTicketDetail("notes", "NA-1")).children).toEqual([]);
    expect(listTickets).not.toHaveBeenCalled();
  });
});
