import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { serializeTicket, type Ticket } from "../shared/ticket-format";
import { fetchLiveAgent } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { forgetOwnerStart, markOwnerStarted } from "./owner-start";
import { forgetTicketFile, viewTicket } from "./tickets";

const scratch = mkdtempSync(join(tmpdir(), "taro-owner-start-"));
const tracker = join(scratch, "tracker");

vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn() }));
vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker }) }));
vi.mock("./supervision", () => ({
  identityFromLabels: (labels: Record<string, string>) =>
    labels["taro.role"] === undefined ? null : { project: labels["taro.project"], role: labels["taro.role"], ticket: labels["taro.ticket"] ?? null, title: null },
}));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const paseo = {} as PaseoApi;
const now = () => new Date("2026-10-14T09:00:00.000Z");
const owner = { "taro.project": "notes-app", "taro.role": "owner", "taro.ticket": "NA-003" };
let agentCount = 0;

function queued(overrides: Partial<Ticket> = {}): void {
  const ticket: Ticket = {
    id: "NA-003", title: "Export notes", status: "Queued", priority: null, labels: [], parent: null, dependsOn: [],
    created: "2026-10-14T08:50:00Z", updated: "2026-10-14T08:50:00Z", description: "", plan: "", criteria: [], notes: "", finalSummary: "", extra: {},
    ...overrides,
  };
  writeFileSync(join(tracker, "tickets", `${ticket.id}.md`), serializeTicket(ticket));
  forgetTicketFile(tracker, `${ticket.id}.md`);
}

/** A fresh agent id per test: the module remembers the agents it looked at. */
function liveAgent(labels: Record<string, string> | null): string {
  const id = `agent-${++agentCount}`;
  vi.mocked(fetchLiveAgent).mockResolvedValue(labels === null ? null : ({ id, labels } as unknown as PaseoAgent));
  return id;
}

beforeEach(() => {
  vi.mocked(fetchLiveAgent).mockReset();
  rmSync(tracker, { recursive: true, force: true });
  mkdirSync(join(tracker, "tickets"), { recursive: true });
  writeFileSync(join(tracker, "tracker.json"), '{"schema":1,"prefix":"NA","padding":3,"lastId":3,"lastChild":{}}\n');
  queued();
});

describe("markOwnerStarted (TR-173)", () => {
  it("sets the owner's Queued ticket Planning at its first turn start, with a record naming the owner", async () => {
    const id = liveAgent(owner);
    expect(await markOwnerStarted(paseo, id, now)).toBe("NA-003");
    const detail = await viewTicket(tracker, "NA-003");
    expect(detail.status).toBe("Planning");
    expect(detail.implementationNotes).toBe(`OWNER-STARTED 2026-10-14T09:00:00.000Z — the plugin set Planning: owner ${id} started on this Queued ticket`);
  });

  it("looks at each agent once: a later turn neither reads Paseo nor writes again", async () => {
    const id = liveAgent(owner);
    await markOwnerStarted(paseo, id, now);
    queued({ notes: "back to Queued by hand" });
    expect(await markOwnerStarted(paseo, id, now)).toBeNull();
    expect(fetchLiveAgent).toHaveBeenCalledTimes(1);
    expect((await viewTicket(tracker, "NA-003")).status).toBe("Queued");
  });

  it("looks again once the agent is forgotten (archived)", async () => {
    const id = liveAgent(owner);
    await markOwnerStarted(paseo, id, now);
    queued();
    forgetOwnerStart(id);
    expect(await markOwnerStarted(paseo, id, now)).toBe("NA-003");
  });

  it("leaves a ticket already past Queued alone: a takeover keeps its status", async () => {
    queued({ status: "In Progress", notes: "APPROVAL 2026-10-14T08:55Z — the user: \"Approve\"" });
    expect(await markOwnerStarted(paseo, liveAgent(owner), now)).toBeNull();
    const detail = await viewTicket(tracker, "NA-003");
    expect(detail.status).toBe("In Progress");
    expect(detail.implementationNotes).not.toContain("OWNER-STARTED");
  });

  it.each(["manager", "implementer", "reviewer", "researcher"])("leaves the ticket alone for a %s", async (role) => {
    expect(await markOwnerStarted(paseo, liveAgent({ ...owner, "taro.role": role }), now)).toBeNull();
    expect((await viewTicket(tracker, "NA-003")).status).toBe("Queued");
  });

  it("does nothing for an agent that is not Taro's, or an owner with no ticket", async () => {
    expect(await markOwnerStarted(paseo, liveAgent({}), now)).toBeNull();
    expect(await markOwnerStarted(paseo, liveAgent({ "taro.project": "notes-app", "taro.role": "owner" }), now)).toBeNull();
    expect((await viewTicket(tracker, "NA-003")).status).toBe("Queued");
  });

  it("looks again at the next turn when Paseo could not say who the agent is", async () => {
    const id = liveAgent(null);
    expect(await markOwnerStarted(paseo, id, now)).toBeNull();
    vi.mocked(fetchLiveAgent).mockResolvedValue({ id, labels: owner } as unknown as PaseoAgent);
    expect(await markOwnerStarted(paseo, id, now)).toBe("NA-003");
  });

  it("does not look again for a ticket the tracker does not hold", async () => {
    const id = liveAgent({ ...owner, "taro.ticket": "NA-099" });
    expect(await markOwnerStarted(paseo, id, now)).toBeNull();
    expect(await markOwnerStarted(paseo, id, now)).toBeNull();
    expect(fetchLiveAgent).toHaveBeenCalledTimes(1);
  });

  it("looks again at the next turn when the write failed", async () => {
    writeFileSync(join(tracker, "tickets", "NA-003.md"), "not a ticket\n");
    forgetTicketFile(tracker, "NA-003.md");
    const id = liveAgent(owner);
    await expect(markOwnerStarted(paseo, id, now)).rejects.toThrow();
    queued();
    expect(await markOwnerStarted(paseo, id, now)).toBe("NA-003");
  });
});
