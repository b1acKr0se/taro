// TR-171: a replaced agent's chat queue moves to its replacement (a fresh manager, a relaunched owner),
// in order, with its attachments and failed marks, and survives a crash between the archive and the start;
// a plain archive still deletes it. A real queue on a temporary directory, against a fake Paseo.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { carriedSlot, type QueuedMessage } from "../shared/chat-queue";
import type { StoredDecision } from "../shared/state";
import { Actions } from "./actions";
import { ChatQueue } from "./chat-queue";
import type { PaseoAgent, PaseoApi, TimelineItem } from "./host-types";
import { launchManager, restartManager } from "./manager";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import type { TrackerWatch } from "./tracker-watch";

let live: PaseoAgent[] = [];
let directory: string;
let home: string;

vi.mock("./agents", () => ({
  projectAgents: vi.fn(async (_paseo: unknown, _project: string, role?: string) => live.filter((agent) => role === undefined || agent.labels["taro.role"] === role)),
  listTaroAgents: vi.fn(async (_paseo: unknown, labels: Record<string, string>) => live.filter((agent) => Object.entries(labels).every(([key, value]) => agent.labels[key] === value))),
  projectArchivedAgents: vi.fn(async () => []),
  fetchLiveAgent: vi.fn(async (_paseo: unknown, id: string) => live.find((agent) => agent.id === id) ?? null),
  isAgentGone: vi.fn(async () => false),
  isMidTurn: (agent: { status: string }) => agent.status === "running" || agent.status === "initializing",
}));
vi.mock("./package-files", async (importOriginal) => ({ ...(await importOriginal<typeof import("./package-files")>()), skillDirectory: async () => "/skill" }));
vi.mock("./projects", () => ({
  projectPaths: async () => ({ home: "/home/notes", tracker: "/tracker", agents: join(home, "AGENTS.md"), standingOrders: "/orders", suggestions: "/suggestions" }),
  listProjectConfigs: async () => [],
  requireProjectConfig: async () => ({
    project: "notes",
    repoPath: "/home/user/notes",
    baseBranch: "main",
    ticketPrefix: "NA",
    paseoProjectId: "p",
    managerAgentId: "manager-1",
    managerWorkspaceId: "ws-manager",
    manager: { model: "claude/haiku", thinking: "" },
    owner: { model: "claude/haiku", thinking: "" },
    subagentModels: [],
    delivery: "local-only",
    acceptAlsoMerges: false,
    maxParallelOwners: 2,
  }),
  updateProjectConfig: vi.fn(async () => ({})),
}));
vi.mock("./headroom", () => ({ readHeadroom: async () => null }));
vi.mock("./models", () => ({ bypassModeId: async () => null, knownBypassMode: () => "" }));
vi.mock("./environment", () => ({ taroEnvironment: async () => ({}) }));
vi.mock("./taro-project", () => ({ ensureTaroProject: async () => ({ projectId: "taro-project" }) }));
vi.mock("./tickets", () => ({
  listTickets: vi.fn(async () => []),
  viewTicket: vi.fn(async (_tracker: string, id: string) => ({ id, title: "Notes list", status: "In Progress", parentTaskId: null, labels: [], dependencies: [], implementationNotes: "", updatedAt: "2026-01-05T09:00:00Z" })),
  appendTicketNote: vi.fn(async () => undefined),
}));

function agent(id: string, role: string, ticket: string | null = null): PaseoAgent {
  const labels: Record<string, string> = { "taro.project": "notes", "taro.role": role };
  if (ticket !== null) labels["taro.ticket"] = ticket;
  return { id, status: "idle", workspaceId: role === "manager" ? "ws-manager" : "wks_NA1", updatedAt: "2026-01-05T09:00:00Z", labels } as unknown as PaseoAgent;
}

const sent: { agentId: string; text: string; messageId: string | undefined; images: unknown[] }[] = [];
let created = 0;
/** What the archive hook does in index.server.ts, run as Paseo archives: the queue's `forget`. */
let onArchive: (agentId: string) => Promise<void> = async () => undefined;
let failArchive = false;

const paseo = {
  agents: {
    ref: (id: string) => ({
      archive: async () => {
        if (failArchive) throw new Error("Paseo is busy");
        live = live.filter((each) => each.id !== id);
        await onArchive(id);
      },
      send: async (text: string, options: { messageId?: string; images?: unknown[] }) => {
        sent.push({ agentId: id, text, messageId: options.messageId, images: options.images ?? [] });
        const target = live.find((each) => each.id === id);
        if (target !== undefined) (target as { status: string }).status = "running";
      },
      timeline: { refetch: async () => ({ entries: [] as { item: TimelineItem }[], hasOlder: false, startCursor: null }) },
    }),
  },
  workspaces: {
    ref: () => ({
      refresh: async () => ({ id: "ws-manager" }),
      agents: {
        create: async (input: { agentId?: string; labels: Record<string, string> }) => {
          created += 1;
          const id = input.agentId ?? `manager-${created + 1}`;
          live.push(agent(id, input.labels["taro.role"] ?? "owner", input.labels["taro.ticket"] ?? null));
          return { id };
        },
      },
    }),
  },
} as unknown as PaseoApi;

let decisions: StoredDecision[] = [];
const state = { forgetAgent: async () => undefined, agent: async () => null, updateDecisions: async <T>(change: (stored: StoredDecision[]) => T) => change(decisions) } as unknown as PluginState;
const supervisor = { withdrawDecisionsOf: async () => 0 } as unknown as Supervisor;

const IMAGE = { mimeType: "image/png", data: Buffer.from("png").toString("base64") };

function queued(id: string, extra: Partial<QueuedMessage> = {}): QueuedMessage {
  return { id, text: `words ${id}`, images: [], files: [], at: "2026-10-16T10:00:00.000Z", failed: null, ...extra };
}

function newQueue(): ChatQueue {
  return new ChatQueue(state, { directory: () => directory });
}

async function listed(queue: ChatQueue, agentId: string): Promise<[string, number, string | null][]> {
  return (await queue.list(agentId)).map((each) => [each.id, each.imageCount, each.failed]);
}

async function carriedFiles(): Promise<string[]> {
  return readdir(join(directory, "carried")).catch(() => []);
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "taro-chat-queue-carry-"));
  home = await mkdtemp(join(tmpdir(), "taro-chat-queue-carry-home-"));
  live = [];
  sent.length = 0;
  created = 0;
  failArchive = false;
  decisions = [];
  onArchive = async () => undefined;
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe("a replaced agent's chat queue goes to its replacement (TR-171)", () => {
  it("Start a fresh manager: a two-message queue, its image and failed mark, is the new manager's, and drains at its turn end", async () => {
    live = [agent("manager-1", "manager")];
    const queue = newQueue();
    onArchive = (agentId) => queue.forget(agentId);
    await queue.add("manager-1", queued("chat-a", { images: [IMAGE] }));
    await queue.add("manager-1", queued("chat-b", { failed: "Agent not accepting prompts" }));

    const { agentId } = await restartManager(paseo, "notes", { queue });

    expect(agentId).toBe("manager-2");
    expect(await listed(queue, "manager-2")).toEqual([
      ["chat-a", 1, null],
      ["chat-b", 0, "Agent not accepting prompts"],
    ]);
    expect(await listed(queue, "manager-1")).toEqual([]);
    expect(await listed(newQueue(), "manager-2")).toEqual(await listed(queue, "manager-2"));
    expect(await carriedFiles()).toEqual([]);
    // The new manager's first turn end sends the front, with its image.
    expect(await queue.drain(paseo, "manager-2", "completed")).toBe(true);
    expect(sent).toEqual([expect.objectContaining({ agentId: "manager-2", messageId: "chat-a", images: [IMAGE] })]);
  });

  it("a message queued to the old manager as it is archived goes along, behind the rest", async () => {
    live = [agent("manager-1", "manager")];
    const queue = newQueue();
    await queue.add("manager-1", queued("chat-a"));
    await queue.add("manager-1", queued("chat-b"));
    // Queued in the gap, and the archive hook runs after Paseo's archive answered.
    onArchive = async () => void (await queue.add("manager-1", queued("chat-c")));
    await restartManager(paseo, "notes", { queue });
    await queue.forget("manager-1");
    expect((await listed(queue, "manager-2")).map(([id]) => id)).toEqual(["chat-a", "chat-b", "chat-c"]);
  });

  it("a manager whose archive fails keeps its queue", async () => {
    live = [agent("manager-1", "manager")];
    const queue = newQueue();
    await queue.add("manager-1", queued("chat-a"));
    await queue.add("manager-1", queued("chat-b"));
    failArchive = true;
    await expect(restartManager(paseo, "notes", { queue })).rejects.toThrow("Paseo is busy");
    expect((await listed(queue, "manager-1")).map(([id]) => id)).toEqual(["chat-a", "chat-b"]);
    expect(await carriedFiles()).toEqual([]);
  });

  it("an owner relaunch: a two-message queue is the new owner's", async () => {
    live = [agent("owner-1", "owner", "NA-1")];
    const queue = newQueue();
    onArchive = (agentId) => queue.forget(agentId);
    await queue.add("owner-1", queued("chat-a", { images: [IMAGE] }));
    await queue.add("owner-1", queued("chat-b"));
    const actions = new Actions(state, supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery, queue);

    const ownerId = await actions.relaunchOwner(paseo, "notes", "NA-1");

    expect(await listed(queue, ownerId)).toEqual([
      ["chat-a", 1, null],
      ["chat-b", 0, null],
    ]);
    expect(await listed(queue, "owner-1")).toEqual([]);
    expect(await queue.drain(paseo, ownerId, "completed")).toBe(true);
    expect(sent.map((each) => [each.agentId, each.messageId])).toEqual([[ownerId, "chat-a"]]);
  });

  it("a plain archive (the user's, Done's cleanup) deletes the queue", async () => {
    const queue = newQueue();
    await queue.add("owner-1", queued("chat-a"));
    await queue.add("owner-1", queued("chat-b"));
    await queue.forget("owner-1");
    expect(await queue.list("owner-1")).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  it("a manager's queue carried before a crash is taken by the next manager started", async () => {
    const before = newQueue();
    await before.add("manager-1", queued("chat-a"));
    await before.add("manager-1", queued("chat-b"));
    await before.carry("manager-1", carriedSlot("notes", "manager"));
    // The plugin died after the archive, before the new manager started; the user starts one.
    const after = newQueue();
    const { agentId } = await launchManager(paseo, "notes", after);
    expect((await listed(after, agentId)).map(([id]) => id)).toEqual(["chat-a", "chat-b"]);
    expect(await carriedFiles()).toEqual([]);
  });

  it("an owner's queue carried before a crash is taken by the next owner of that ticket, and no other", async () => {
    const before = newQueue();
    await before.add("owner-1", queued("chat-a"));
    await before.add("owner-1", queued("chat-b"));
    await before.carry("owner-1", carriedSlot("notes", "owner", "NA-1"));
    const after = newQueue();
    const actions = new Actions(state, supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery, after);
    live = [agent("owner-9", "owner", "NA-2")];
    const other = await actions.relaunchOwner(paseo, "notes", "NA-2");
    expect(await after.list(other)).toEqual([]);
    live = [agent("owner-old", "owner", "NA-1")];
    const ownerId = await actions.relaunchOwner(paseo, "notes", "NA-1");
    expect((await listed(after, ownerId)).map(([id]) => id)).toEqual(["chat-a", "chat-b"]);
  });

  it("a carried queue goes ahead of messages already queued to the replacement, one copy per id", async () => {
    const queue = newQueue();
    await queue.add("manager-1", queued("chat-a"));
    await queue.add("manager-1", queued("chat-b"));
    await queue.carry("manager-1", carriedSlot("notes", "manager"));
    await queue.add("manager-2", queued("chat-b"));
    await queue.add("manager-2", queued("chat-c"));
    expect(await queue.claim(carriedSlot("notes", "manager"), "manager-2")).toBe(2);
    expect((await listed(queue, "manager-2")).map(([id]) => id)).toEqual(["chat-a", "chat-b", "chat-c"]);
  });
});
