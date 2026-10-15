/** Change spec… on a Queued ticket (TR-129): the user's words reach the manager, tagged with the ticket, and land in its records. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changeQueuedSpec } from "../shared/contracts";
import { Actions } from "./actions";
import { fetchLiveAgent, listTaroAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { appendTicketNote, viewTicket, type TicketDetail } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", async (original) => ({ ...(await original<typeof import("./agents")>()), fetchLiveAgent: vi.fn(), listTaroAgents: vi.fn() }));
vi.mock("./tickets", async (original) => ({ ...(await original<typeof import("./tickets")>()), viewTicket: vi.fn(), appendTicketNote: vi.fn() }));
vi.mock("./projects", async (original) => ({
  ...(await original<typeof import("./projects")>()),
  requireProjectConfig: async (project: string) => ({ project, managerAgentId: "manager-1" }),
  projectPaths: async () => ({ tracker: "/home/user/tracker" }),
}));

let ticket: Partial<TicketDetail>;
let owners: PaseoAgent[];
let managerLive: boolean;
let sent: { agentId: string; text: string; options: { messageId?: string } }[];
let notes: string[];
let paseo: PaseoApi;
let actions: Actions;

beforeEach(() => {
  ticket = { id: "TR-7", title: "Export notes as Markdown", status: "Queued", parentTaskId: null, implementationNotes: "DISPATCH-INTENT 2026-01-05T10:00Z — TR-7" };
  owners = [];
  managerLive = true;
  sent = [];
  notes = [];
  vi.mocked(viewTicket).mockImplementation(async () => ticket as TicketDetail);
  vi.mocked(appendTicketNote).mockImplementation(async (_tracker, _id, record) => void notes.push(record));
  vi.mocked(listTaroAgents).mockImplementation(async () => owners);
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (managerLive && id === "manager-1" ? ({ id, status: "idle" } as unknown as PaseoAgent) : null));
  paseo = {
    agents: { ref: (agentId: string) => ({ send: async (text: string, options: (typeof sent)[number]["options"]) => void sent.push({ agentId, text, options }) }) },
  } as unknown as PaseoApi;
  actions = new Actions({} as PluginState, {} as Supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
});

afterEach(() => vi.clearAllMocks());

describe("Change spec… on a Queued ticket", () => {
  it("sends the user's words to the manager as theirs, tagged with the ticket and its title", async () => {
    await actions.changeQueuedSpec(paseo, "notes-app", "TR-7", "  Also export the tags, as front matter.  ");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.agentId).toBe("manager-1");
    expect(sent[0]?.text.split("\n")[0]).toBe("Spec change for queued TR-7 (Export notes as Markdown): Also export the tags, as front matter.");
    expect(sent[0]?.text).toContain("Rewrite TR-7's Description");
    // No plugin message id: the manager's chat shows the words as the user's.
    expect(sent[0]?.options.messageId).toBeUndefined();
  });

  it("records the words as a SCOPE-CHANGE once the manager has them", async () => {
    await actions.changeQueuedSpec(paseo, "notes-app", "TR-7", "Also export the tags");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^SCOPE-CHANGE \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z — sent to the manager before an owner started; the user: "Also export the tags"$/);
  });

  it("keeps placeholder-like words as typed", async () => {
    await actions.changeQueuedSpec(paseo, "notes-app", "TR-7", "use {{title}} as the file name");
    expect(sent[0]?.text.split("\n")[0]).toBe("Spec change for queued TR-7 (Export notes as Markdown): use {{title}} as the file name");
  });

  it("refuses empty words, sending and recording nothing", async () => {
    await expect(actions.changeQueuedSpec(paseo, "notes-app", "TR-7", "   ")).rejects.toThrow("Say what to change first.");
    expect(sent).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("refuses a ticket an owner has started, pointing to its chat", async () => {
    ticket.status = "Planning";
    await expect(actions.changeQueuedSpec(paseo, "notes-app", "TR-7", "Also tags")).rejects.toThrow("TR-7 is Planning now. Tell its owner in its chat instead.");
    expect(sent).toEqual([]);
  });

  it("refuses a Queued ticket whose owner is already running", async () => {
    owners = [{ id: "owner-1", status: "running" } as unknown as PaseoAgent];
    await expect(actions.changeQueuedSpec(paseo, "notes-app", "TR-7", "Also tags")).rejects.toThrow("has an owner now");
    expect(sent).toEqual([]);
  });

  it("still sends when the ticket's only owner was archived", async () => {
    owners = [{ id: "owner-0", status: "closed" } as unknown as PaseoAgent];
    await actions.changeQueuedSpec(paseo, "notes-app", "TR-7", "Also tags");
    expect(sent).toHaveLength(1);
  });

  it("refuses a child ticket and a paused one", async () => {
    ticket.parentTaskId = "TR-6";
    await expect(actions.changeQueuedSpec(paseo, "notes-app", "TR-7", "Also tags")).rejects.toThrow("part of TR-6");
    ticket.parentTaskId = null;
    ticket.implementationNotes = "PAUSE-REQUESTED 2026-01-05T10:00Z — by the user\n\nHOLD 2026-01-05T10:01Z — paused by the user";
    await expect(actions.changeQueuedSpec(paseo, "notes-app", "TR-7", "Also tags")).rejects.toThrow("paused");
    expect(sent).toEqual([]);
  });

  it("records nothing when the project has no manager", async () => {
    managerLive = false;
    await expect(actions.changeQueuedSpec(paseo, "notes-app", "TR-7", "Also tags")).rejects.toThrow("has no manager");
    expect(notes).toEqual([]);
  });

  it("takes words only: the contract refuses an empty text", () => {
    expect(() => changeQueuedSpec.input.parse({ project: "notes-app", ticket: "TR-7", text: "" })).toThrow();
    expect(changeQueuedSpec.name).toMatch(/^[a-z][a-z0-9._-]*$/);
  });
});
