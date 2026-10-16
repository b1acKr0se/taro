// TR-081: the plugin's ticket reads and writes go through the store in process, in the shapes callers always had.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serializeTicket, type Ticket } from "../shared/ticket-format";
import { appendTicketNote, endDelivery, forgetTicketFile, listTickets, recordChangesRequested, ticketProblems, viewTicket } from "./tickets";

vi.mock("node:child_process", () => ({
  spawn: () => {
    throw new Error("no process may be started for a ticket");
  },
}));

let tracker = "";

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    id: "NA-001",
    title: "Export notes",
    status: "In Progress",
    priority: "high",
    labels: ["complexity-low"],
    parent: null,
    dependsOn: [],
    created: "2026-10-14T15:46:00Z",
    updated: "2026-10-14T16:20:31Z",
    description: "",
    plan: "",
    criteria: [],
    notes: "",
    finalSummary: "",
    extra: {},
    ...overrides,
  };
}

function write(value: Ticket): void {
  writeFileSync(join(tracker, "tickets", `${value.id}.md`), serializeTicket(value));
}

beforeEach(() => {
  tracker = mkdtempSync(join(tmpdir(), "taro-tickets-"));
  mkdirSync(join(tracker, "tickets"));
  writeFileSync(join(tracker, "tracker.json"), '{"schema":1,"prefix":"NA","padding":3,"lastId":3,"lastChild":{"NA-001":1}}\n');
  write(
    ticket({
      dependsOn: ["NA-000"],
      description: "Export every note.\n\n## Scope\nAll of them.",
      plan: "1. Write it.",
      criteria: [
        { index: 1, text: "CSV works", checked: true },
        { index: 2, text: "JSON works", checked: false },
      ],
      notes: "EXECUTION 2026-10-14T15:50:00Z — owner o",
      finalSummary: "Shipped.",
    }),
  );
  write(ticket({ id: "NA-001.01", title: "CSV", status: "Done", priority: null, labels: [], parent: "NA-001", created: "2026-10-14T15:47:00Z", updated: "2026-10-14T15:48:00Z" }));
  write(ticket({ id: "NA-002", title: "Empty", status: "Queued", priority: null, labels: [] }));
});

afterEach(() => {
  rmSync(tracker, { recursive: true, force: true });
});

describe("listTickets", () => {
  it("maps every summary field", async () => {
    expect(await listTickets(tracker)).toEqual([
      {
        id: "NA-001",
        title: "Export notes",
        status: "In Progress",
        priority: "high",
        labels: ["complexity-low"],
        parentTaskId: null,
        dependencies: ["NA-000"],
        acceptanceCriteriaCompleted: 1,
        acceptanceCriteriaCount: 2,
        createdAt: "2026-10-14T15:46:00Z",
        updatedAt: "2026-10-14T16:20:31Z",
      },
      {
        id: "NA-001.01",
        title: "CSV",
        status: "Done",
        priority: null,
        labels: [],
        parentTaskId: "NA-001",
        dependencies: [],
        acceptanceCriteriaCompleted: 0,
        acceptanceCriteriaCount: 0,
        createdAt: "2026-10-14T15:47:00Z",
        updatedAt: "2026-10-14T15:48:00Z",
      },
      expect.objectContaining({ id: "NA-002", status: "Queued" }),
    ]);
  });
});

describe("viewTicket", () => {
  it("maps every detail field, with its children and their status", async () => {
    expect(await viewTicket(tracker, "NA-001")).toEqual({
      id: "NA-001",
      title: "Export notes",
      status: "In Progress",
      priority: "high",
      labels: ["complexity-low"],
      parentTaskId: null,
      dependencies: ["NA-000"],
      acceptanceCriteriaCompleted: 1,
      acceptanceCriteriaCount: 2,
      createdAt: "2026-10-14T15:46:00Z",
      updatedAt: "2026-10-14T16:20:31Z",
      description: "Export every note.\n\n## Scope\nAll of them.",
      acceptanceCriteria: [
        { index: 1, text: "CSV works", checked: true },
        { index: 2, text: "JSON works", checked: false },
      ],
      implementationPlan: "1. Write it.",
      implementationNotes: "EXECUTION 2026-10-14T15:50:00Z — owner o",
      finalSummary: "Shipped.",
      subtasks: [{ id: "NA-001.01", title: "CSV", status: "Done" }],
    });
  });

  it("reads empty sections as null", async () => {
    expect(await viewTicket(tracker, "NA-002")).toMatchObject({ description: null, implementationPlan: null, implementationNotes: null, finalSummary: null, acceptanceCriteria: [], subtasks: [] });
  });

  it("fails for a ticket that does not exist", async () => {
    await expect(viewTicket(tracker, "NA-009")).rejects.toThrow(/NA-009 does not exist/);
  });
});

describe("appendTicketNote", () => {
  it("lands the record verbatim, `$` patterns included, after the notes already there", async () => {
    const record = "ANSWER 2026-10-14T16:00:00Z — cost $& and $$ and $1 → \"$'\" ✓";
    await appendTicketNote(tracker, "NA-001", record);
    const detail = await viewTicket(tracker, "NA-001");
    expect(detail.implementationNotes).toBe(`EXECUTION 2026-10-14T15:50:00Z — owner o\n\n${record}`);
    expect(readFileSync(join(tracker, "tickets", "NA-001.md"), "utf8")).toContain(record);
  });
});

describe("recordChangesRequested (TR-131)", () => {
  const record = 'CHANGES-REQUESTED 2026-10-14T16:00:00Z — the user: "Rename the button"';

  it("moves a ticket Awaiting acceptance to In Progress and lands the record, in one write", async () => {
    write(ticket({ id: "NA-003", title: "Delivered", status: "Awaiting acceptance", notes: "EVIDENCE 2026-10-14T15:55:00Z — check: npm test — passed" }));
    await recordChangesRequested(tracker, "NA-003", record);
    const detail = await viewTicket(tracker, "NA-003");
    expect(detail.status).toBe("In Progress");
    expect(detail.implementationNotes).toBe(`EVIDENCE 2026-10-14T15:55:00Z — check: npm test — passed\n\n${record}`);
  });

  it.each(["In Progress", "Reviewing", "Done", "Blocked", "Queued"] as const)("leaves a %s ticket's status alone and still lands the record", async (status) => {
    write(ticket({ id: "NA-003", title: "Elsewhere", status }));
    await recordChangesRequested(tracker, "NA-003", record);
    const detail = await viewTicket(tracker, "NA-003");
    expect(detail.status).toBe(status);
    expect(detail.implementationNotes).toBe(record);
  });
});

describe("endDelivery (TR-130)", () => {
  const evidence = "EVIDENCE 2026-10-14T15:55:00Z — check: npm test — passed";
  const record = "DELIVERY-ENDED 2026-10-14T16:00:00Z — the owner asked `rename-scope` while awaiting acceptance: back to In Progress until it delivers again";

  it("moves a delivery on offer to In Progress and lands the record, in one write", async () => {
    write(ticket({ id: "NA-003", title: "Delivered", status: "Awaiting acceptance", notes: evidence }));
    expect(await endDelivery(tracker, "NA-003", record)).toBe(true);
    const detail = await viewTicket(tracker, "NA-003");
    expect(detail.status).toBe("In Progress");
    expect(detail.implementationNotes).toBe(`${evidence}\n\n${record}`);
  });

  it("writes nothing once the user accepted: the owner is merging", async () => {
    const accepted = `${evidence}\n\nACCEPTED 2026-10-14T15:58:00Z — the user accepted; merging: the pull request`;
    write(ticket({ id: "NA-003", title: "Accepted", status: "Awaiting acceptance", notes: accepted }));
    const before = readFileSync(join(tracker, "tickets", "NA-003.md"), "utf8");
    expect(await endDelivery(tracker, "NA-003", record)).toBe(false);
    expect(readFileSync(join(tracker, "tickets", "NA-003.md"), "utf8")).toBe(before);
  });

  it.each(["In Progress", "Reviewing", "Done", "Blocked", "Planning"] as const)("writes nothing to a %s ticket", async (status) => {
    write(ticket({ id: "NA-003", title: "Elsewhere", status, notes: evidence }));
    expect(await endDelivery(tracker, "NA-003", record)).toBe(false);
    const detail = await viewTicket(tracker, "NA-003");
    expect(detail.status).toBe(status);
    expect(detail.implementationNotes).toBe(evidence);
  });
});

describe("ticketProblems", () => {
  it("names a bad file and its line, and lists the other tickets", async () => {
    writeFileSync(join(tracker, "tickets", "NA-003.md"), serializeTicket(ticket({ id: "NA-003" })).replace('title: "Export notes"', "title: oops"));
    expect((await listTickets(tracker)).map((summary) => summary.id)).toEqual(["NA-001", "NA-001.01", "NA-002"]);
    const problems = await ticketProblems(tracker);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatchObject({ file: "tickets/NA-003.md", line: 4 });
  });

  it("reads a file again once the watcher forgets it, even with its size and mtime unchanged", async () => {
    const path = join(tracker, "tickets", "NA-002.md");
    const text = readFileSync(path, "utf8");
    utimesSync(path, 1_700_000_000, 1_700_000_000);
    await listTickets(tracker);
    writeFileSync(path, text.replace('title: "Empty"', 'title: "Emptx"'));
    utimesSync(path, 1_700_000_000, 1_700_000_000);
    expect((await listTickets(tracker)).find((summary) => summary.id === "NA-002")?.title).toBe("Empty");
    forgetTicketFile(tracker, "NA-002.md");
    expect((await listTickets(tracker)).find((summary) => summary.id === "NA-002")?.title).toBe("Emptx");
  });
});
