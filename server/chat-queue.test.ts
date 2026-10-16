/**
 * The chat queue on the daemon (TR-171): its files, the drain, Send now, Edit and Retry, and the turn
 * ends that drain it, against a fake Paseo whose agent starts a turn on each send it takes.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listChatQueue, retryQueuedMessage, sendQueuedMessageNow, takeQueuedMessage } from "../shared/contracts";
import { INTERRUPT_NOTE_START, stripInterruptNote, type QueuedMessage } from "../shared/chat-queue";
import { AgentStateSchema, type AgentState } from "../shared/state";
import { ChatQueue } from "./chat-queue";
import type { HookAgent, PaseoAgent, PaseoApi, TimelineItem, TurnOutcome } from "./host-types";
import { message, TEMPLATES } from "./package-files";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import { Supervisor } from "./supervision";

vi.mock("./projects", async (original) => ({ ...(await original<typeof import("./projects")>()), readProjectConfig: async () => null, projectPaths: async () => ({ tracker: "/tracker", home: "/home" }) }));
vi.mock("./tickets", async (original) => ({ ...(await original<typeof import("./tickets")>()), viewTicket: vi.fn(async () => Promise.reject(new Error("no tracker here"))) }));

interface FakeAgent {
  id: string;
  status: string;
  provider: string;
  title: string;
  labels: Record<string, string>;
  updatedAt: string;
  archivedAt: string | null;
  pendingPermissions: unknown[];
}

interface Sent {
  agentId: string;
  text: string;
  behavior: string | undefined;
  messageId: string | undefined;
  images: unknown[];
  attachments: { fileName: string; path: string }[];
  /** The agent's status as the send reached Paseo: a queued message must only ever find it idle. */
  statusAtSend: string;
}

let directory: string;
let home: string;
let previousHome: string | undefined;
let clock: number;
let agents: Record<string, FakeAgent>;
let records: Record<string, AgentState>;
let sent: Sent[];
let timelines: Record<string, { item: TimelineItem; timestamp: string }[]>;
let failSends: Error | null;
let paseo: PaseoApi;

function agent(id: string, role: string, status = "idle"): FakeAgent {
  const labels: Record<string, string> = { "taro.project": "taro", "taro.role": role };
  if (role !== "manager") labels["taro.ticket"] = "TR-9";
  return { id, status, provider: "codex", title: `TR-9 · ${role}`, labels, updatedAt: new Date(clock).toISOString(), archivedAt: null, pendingPermissions: [] };
}

const state = {
  agent: async (agentId: string) => records[agentId] ?? null,
  allDecisions: async () => [],
  updateDecisions: async <T>(change: (decisions: never[]) => T) => change([]),
  updateAgent: async <T>(agentId: string, initial: () => AgentState, change: (record: AgentState) => T) => {
    const record = records[agentId] ?? initial();
    records[agentId] = record;
    return change(record);
  },
} as unknown as PluginState;

function newQueue(): ChatQueue {
  return new ChatQueue(state, { directory: () => directory, now: () => clock });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "taro-chat-queue-"));
  home = await mkdtemp(join(tmpdir(), "taro-chat-queue-home-"));
  previousHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  clock = Date.parse("2026-10-16T10:00:00.000Z");
  agents = { "owner-1": agent("owner-1", "owner", "running") };
  records = {};
  sent = [];
  timelines = {};
  failSends = null;
  paseo = {
    agents: {
      list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } }),
      ref: (agentId: string) => ({
        refresh: async () => (agents[agentId] === undefined ? null : { agent: { ...agents[agentId] } as unknown as PaseoAgent }),
        send: async (text: string, options: { activeTurnBehavior?: string; messageId?: string; images?: unknown[]; attachments?: Sent["attachments"] }) => {
          const target = agents[agentId];
          if (target === undefined) throw new Error("Agent not found");
          if (failSends !== null) throw failSends;
          sent.push({ agentId, text, behavior: options.activeTurnBehavior, messageId: options.messageId, images: options.images ?? [], attachments: options.attachments ?? [], statusAtSend: target.status });
          (timelines[agentId] ??= []).push({ item: { type: "user_message", text, clientMessageId: options.messageId } as unknown as TimelineItem, timestamp: new Date(clock).toISOString() });
          // Paseo starts a turn for a prompt it takes, and keeps the agent busy through an interrupt's replacement.
          target.status = "running";
        },
        timeline: { refetch: async () => ({ entries: timelines[agentId] ?? [], hasOlder: false, startCursor: null }) },
      }),
    },
  } as unknown as PaseoApi;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(directory, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

const base64 = (text: string) => Buffer.from(text).toString("base64");
const IMAGE = { mimeType: "image/png", data: base64("png") };
const FILE = { fileName: "notes.txt", mimeType: "text/plain", data: base64("notes") };

function message_(id: string, extra: Partial<QueuedMessage> = {}): QueuedMessage {
  return { id, text: `words ${id}`, images: [], files: [], at: "2026-10-16T10:00:00.000Z", failed: null, ...extra };
}

async function ids(queue: ChatQueue, agentId = "owner-1"): Promise<string[]> {
  return (await queue.list(agentId)).map((entry) => entry.id);
}

function live(agentId = "owner-1"): PaseoAgent {
  return { ...agents[agentId] } as unknown as PaseoAgent;
}

describe("the queue's files", () => {
  it("starts empty, with no file", async () => {
    const queue = newQueue();
    expect(await queue.list("owner-1")).toEqual([]);
    expect(await queue.queuedAgents()).toEqual([]);
  });

  it("keeps messages in order, one copy per id, in one file per agent", async () => {
    const queue = newQueue();
    await queue.add("owner-1", message_("chat-a"));
    await queue.add("owner-1", message_("chat-b"));
    await queue.add("owner-1", message_("chat-a", { text: "again" }));
    await queue.add("other-1", message_("chat-c"));
    expect(await ids(queue)).toEqual(["chat-a", "chat-b"]);
    expect((await queue.list("owner-1"))[0]?.text).toBe("words chat-a");
    expect((await readdir(directory)).sort()).toEqual(["other-1.json", "owner-1.json"]);
  });

  it("keeps one copy of two adds of the same id landing together", async () => {
    const queue = newQueue();
    await Promise.all([queue.add("owner-1", message_("chat-a")), queue.add("owner-1", message_("chat-a")), queue.add("owner-1", message_("chat-b"))]);
    expect(await ids(queue)).toEqual(["chat-a", "chat-b"]);
  });

  it("is read back whole by a new queue on the same directory, as after a plugin restart", async () => {
    const first = newQueue();
    await first.add("owner-1", message_("chat-a", { images: [IMAGE], files: [FILE] }));
    await first.add("owner-1", message_("chat-b"));
    const second = newQueue();
    expect(await ids(second)).toEqual(["chat-a", "chat-b"]);
    expect(await second.take("owner-1", "chat-a")).toEqual({ text: "words chat-a", images: [IMAGE], files: [FILE] });
  });

  it("holds ten attachments, base64, and lists only their count and names", async () => {
    const queue = newQueue();
    const images = Array.from({ length: 5 }, (_unused, index) => ({ mimeType: "image/png", data: base64(`image ${index}`) }));
    const files = Array.from({ length: 5 }, (_unused, index) => ({ fileName: `file-${index}.txt`, mimeType: "text/plain", data: base64(`file ${index}`) }));
    await queue.add("owner-1", message_("chat-a", { images, files }));
    const [summary] = await queue.list("owner-1");
    expect(summary).toEqual({ id: "chat-a", text: "words chat-a", at: "2026-10-16T10:00:00.000Z", imageCount: 5, fileNames: files.map((file) => file.fileName), failed: null });
    expect(JSON.stringify(summary)).not.toContain(images[0]!.data);
    expect(await newQueue().take("owner-1", "chat-a")).toEqual({ text: "words chat-a", images, files });
  });

  it("reads a corrupt file as empty without throwing, and writes over it on the next add", async () => {
    await writeFile(join(directory, "owner-1.json"), "{ not json", "utf8");
    const queue = newQueue();
    expect(await queue.list("owner-1")).toEqual([]);
    await queue.add("owner-1", message_("chat-a"));
    expect(await ids(queue)).toEqual(["chat-a"]);
  });

  it("takes a message out for Edit, and answers an error for one not there", async () => {
    const queue = newQueue();
    await queue.add("owner-1", message_("chat-a"));
    await queue.add("owner-1", message_("chat-b"));
    expect((await queue.take("owner-1", "chat-b")).text).toBe("words chat-b");
    expect(await ids(queue)).toEqual(["chat-a"]);
    await expect(queue.take("owner-1", "chat-b")).rejects.toThrow("no longer queued");
    await expect(queue.sendNow(paseo, "owner-1", "chat-zz")).rejects.toThrow("no longer queued");
    await expect(queue.retry(paseo, "owner-1", "chat-zz")).rejects.toThrow("no longer queued");
    expect(await ids(queue)).toEqual(["chat-a"]);
  });

  it("deletes the file once its last message is gone, and on forget", async () => {
    const queue = newQueue();
    await queue.add("owner-1", message_("chat-a"));
    await queue.take("owner-1", "chat-a");
    expect(await readdir(directory)).toEqual([]);
    await queue.add("owner-1", message_("chat-b"));
    await queue.forget("owner-1");
    expect(await readdir(directory)).toEqual([]);
    expect(await newQueue().list("owner-1")).toEqual([]);
  });
});

describe("telling an agent through the queue", () => {
  it("queues for an agent mid-turn and sends nothing", async () => {
    const queue = newQueue();
    expect(await queue.tell(paseo, live(), "use sqlite", { messageId: "chat-a" }, false)).toEqual({ queued: true });
    expect(sent).toEqual([]);
    expect(await ids(queue)).toEqual(["chat-a"]);
  });

  it("sends to an idle agent at once, steering as before", async () => {
    agents["owner-1"]!.status = "idle";
    const queue = newQueue();
    expect(await queue.tell(paseo, live(), "hello", { messageId: "chat-a" }, false)).toEqual({ queued: false });
    expect(sent).toEqual([expect.objectContaining({ text: "hello", behavior: "steer", messageId: "chat-a", statusAtSend: "idle" })]);
    expect(await queue.list("owner-1")).toEqual([]);
  });

  it("sends words that answer a pending request at once, even mid-turn", async () => {
    const queue = newQueue();
    expect(await queue.tell(paseo, live(), "yes, allow it", { messageId: "chat-a" }, true)).toEqual({ queued: false });
    expect(sent).toEqual([expect.objectContaining({ text: "yes, allow it", behavior: "steer", statusAtSend: "running" })]);
    expect(await queue.list("owner-1")).toEqual([]);
  });

  it("drains at once when the turn ended between the first look and the write", async () => {
    const queue = newQueue();
    const seenRunning = live();
    agents["owner-1"]!.status = "idle";
    expect(await queue.tell(paseo, seenRunning, "late", { messageId: "chat-a" }, false)).toEqual({ queued: true });
    expect(sent).toEqual([expect.objectContaining({ text: "late", messageId: "chat-a", statusAtSend: "idle" })]);
    expect(await queue.list("owner-1")).toEqual([]);
  });

  it("gives a message without a chat id one of its own", async () => {
    const queue = newQueue();
    await queue.tell(paseo, live(), "no id", {}, false);
    expect((await ids(queue))[0]).toMatch(/^chat-/);
  });

  it("refuses too many attachments while the user is there, queueing nothing", async () => {
    const queue = newQueue();
    const images = Array.from({ length: 11 }, () => IMAGE);
    await expect(queue.tell(paseo, live(), "", { images }, false)).rejects.toThrow();
    expect(await queue.list("owner-1")).toEqual([]);
  });
});

describe("draining", () => {
  async function three(queue: ChatQueue): Promise<void> {
    for (const id of ["chat-a", "chat-b", "chat-c"]) await queue.tell(paseo, live(), `words ${id}`, { messageId: id }, false);
  }

  it("sends only the front message, as a new prompt to the idle agent, with its attachments", async () => {
    const queue = newQueue();
    await queue.tell(paseo, live(), "look", { messageId: "chat-a", images: [IMAGE], files: [FILE] }, false);
    await queue.tell(paseo, live(), "second", { messageId: "chat-b" }, false);
    agents["owner-1"]!.status = "idle";
    expect(await queue.drain(paseo, "owner-1", "completed")).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(expect.objectContaining({ text: "look", messageId: "chat-a", images: [IMAGE], statusAtSend: "idle" }));
    expect(sent[0]?.attachments).toEqual([expect.objectContaining({ fileName: "notes.txt", path: expect.stringContaining(join(home, "uploads")) })]);
    expect(await readFile(sent[0]!.attachments[0]!.path, "utf8")).toBe("notes");
    expect(await ids(queue)).toEqual(["chat-b"]);
  });

  it("refuses while the agent works, is gone, compacts, or its front failed", async () => {
    const queue = newQueue();
    await three(queue);
    expect(await queue.drain(paseo, "owner-1", "completed")).toBe(false);
    agents["owner-1"]!.status = "idle";
    records["owner-1"] = AgentStateSchema.parse({ project: "taro", role: "owner", compaction: "handoff" });
    expect(await queue.drain(paseo, "owner-1", "completed")).toBe(false);
    records["owner-1"] = AgentStateSchema.parse({ project: "taro", role: "owner", compaction: "none" });
    await queue.add("gone-1", message_("chat-x"));
    expect(await queue.drain(paseo, "gone-1", "completed")).toBe(false);
    failSends = new Error("Paseo is busy");
    expect(await queue.drain(paseo, "owner-1", "completed")).toBe(false);
    failSends = null;
    expect(await queue.drain(paseo, "owner-1", "completed")).toBe(false);
    expect(sent).toEqual([]);
    expect(await ids(queue)).toEqual(["chat-a", "chat-b", "chat-c"]);
  });

  it("leaves a failed send at the front, marked with the reason, and sends nothing behind it", async () => {
    const queue = newQueue();
    await three(queue);
    agents["owner-1"]!.status = "idle";
    failSends = new Error("Transport closed (code 1006)");
    expect(await queue.drain(paseo, "owner-1", "completed")).toBe(false);
    failSends = null;
    const listed = await queue.list("owner-1");
    expect(listed.map((entry) => [entry.id, entry.failed])).toEqual([
      ["chat-a", "the connection to Paseo dropped."],
      ["chat-b", null],
      ["chat-c", null],
    ]);
    expect(await queue.drain(paseo, "owner-1", "sweep")).toBe(false);
    expect(sent).toEqual([]);
    // Retry clears the mark and sends it.
    expect(await queue.retry(paseo, "owner-1", "chat-a")).toBe(true);
    expect(sent.map((each) => each.messageId)).toEqual(["chat-a"]);
    expect(await ids(queue)).toEqual(["chat-b", "chat-c"]);
  });

  it("does not send twice a message Paseo took before the plugin lost track of it", async () => {
    const queue = newQueue();
    await three(queue);
    // Sent once (the timeline holds it) but still queued, as after a crash between the send and the delete.
    timelines["owner-1"] = [{ item: { type: "user_message", text: "words chat-a", clientMessageId: "chat-a" } as unknown as TimelineItem, timestamp: "2026-10-16T09:59:00.000Z" }];
    agents["owner-1"]!.status = "idle";
    await queue.drain(paseo, "owner-1", "completed");
    expect(sent).toEqual([]);
    expect(await ids(queue)).toEqual(["chat-b", "chat-c"]);
  });

  it("sends one message for two drains landing together", async () => {
    const queue = newQueue();
    await three(queue);
    agents["owner-1"]!.status = "idle";
    const results = await Promise.all([queue.drain(paseo, "owner-1", "completed"), queue.drain(paseo, "owner-1", "sweep")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(sent.map((each) => each.messageId)).toEqual(["chat-a"]);
  });

  it("sends what a previous plugin process queued", async () => {
    await three(newQueue());
    agents["owner-1"]!.status = "idle";
    expect(await newQueue().drain(paseo, "owner-1", "completed")).toBe(true);
    expect(sent.map((each) => each.messageId)).toEqual(["chat-a"]);
  });
});

describe("Send now", () => {
  it("interrupts a running turn with the note before the words, and leaves the rest queued", async () => {
    const queue = newQueue();
    await queue.tell(paseo, live(), "first", { messageId: "chat-a" }, false);
    await queue.tell(paseo, live(), "**stop** the migration", { messageId: "chat-b", images: [IMAGE] }, false);
    await queue.sendNow(paseo, "owner-1", "chat-b");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(expect.objectContaining({ behavior: "interrupt", messageId: "chat-b", images: [IMAGE], statusAtSend: "running" }));
    expect(sent[0]?.text.startsWith(INTERRUPT_NOTE_START)).toBe(true);
    expect(sent[0]?.text).toContain((await message(TEMPLATES.interrupted)).trim());
    expect(stripInterruptNote(sent[0]!.text)).toBe("**stop** the migration");
    expect(await ids(queue)).toEqual(["chat-a"]);
  });

  it("sends to an idle agent without the note", async () => {
    const queue = newQueue();
    await queue.add("owner-1", message_("chat-a", { text: "now please" }));
    agents["owner-1"]!.status = "idle";
    await queue.sendNow(paseo, "owner-1", "chat-a");
    expect(sent).toEqual([expect.objectContaining({ text: "now please", messageId: "chat-a", statusAtSend: "idle" })]);
    expect(await queue.list("owner-1")).toEqual([]);
  });

  it("holds a canceled turn end's drain for 30 s, not a completed one", async () => {
    const queue = newQueue();
    await queue.tell(paseo, live(), "now", { messageId: "chat-a" }, false);
    await queue.tell(paseo, live(), "later", { messageId: "chat-b" }, false);
    await queue.sendNow(paseo, "owner-1", "chat-a");
    // Even if Paseo showed the agent idle in the gap, the cancel is the turn Send now cut off.
    agents["owner-1"]!.status = "idle";
    clock += 29_999;
    expect(await queue.drain(paseo, "owner-1", "canceled")).toBe(false);
    expect(await queue.drain(paseo, "owner-1", "sweep")).toBe(false);
    clock += 1;
    expect(await queue.drain(paseo, "owner-1", "canceled")).toBe(true);
    expect(sent.map((each) => each.messageId)).toEqual(["chat-a", "chat-b"]);
  });

  it("puts a failed message back at the front, marked, and says why", async () => {
    const queue = newQueue();
    await queue.tell(paseo, live(), "first", { messageId: "chat-a" }, false);
    await queue.tell(paseo, live(), "urgent", { messageId: "chat-b" }, false);
    failSends = new Error("Paseo is busy");
    await expect(queue.sendNow(paseo, "owner-1", "chat-b")).rejects.toThrow("Paseo is busy");
    expect((await queue.list("owner-1")).map((entry) => [entry.id, entry.failed])).toEqual([
      ["chat-b", "Paseo is busy"],
      ["chat-a", null],
    ]);
    // The guard went with the failed send: the next cancel drains (once the mark is cleared).
    failSends = null;
    agents["owner-1"]!.status = "idle";
    expect(await queue.retry(paseo, "owner-1", "chat-b")).toBe(true);
    expect(sent.map((each) => each.messageId)).toEqual(["chat-b"]);
  });

  it("is refused while Taro compacts the agent, the message left where it is", async () => {
    const queue = newQueue();
    await queue.tell(paseo, live(), "first", { messageId: "chat-a" }, false);
    records["owner-1"] = AgentStateSchema.parse({ project: "taro", role: "owner", compaction: "compacting" });
    await expect(queue.sendNow(paseo, "owner-1", "chat-a")).rejects.toThrow("compacting");
    expect(sent).toEqual([]);
    expect((await queue.list("owner-1")).map((entry) => [entry.id, entry.failed])).toEqual([["chat-a", null]]);
  });
});

describe("the sweep", () => {
  it("drains an idle agent's queue 10 s after its last turn end, not 9 s", async () => {
    const queue = newQueue();
    await queue.add("owner-1", message_("chat-a"));
    agents["owner-1"]!.status = "idle";
    agents["owner-1"]!.updatedAt = new Date(clock - 60_000).toISOString();
    records["owner-1"] = AgentStateSchema.parse({ project: "taro", role: "owner", lastTurnEndedAt: new Date(clock - 9_000).toISOString() });
    expect(await queue.sweep(paseo)).toBe(0);
    expect(sent).toEqual([]);
    clock += 1_000;
    expect(await queue.sweep(paseo)).toBe(1);
    expect(sent.map((each) => [each.messageId, each.statusAtSend])).toEqual([["chat-a", "idle"]]);
  });

  it("leaves a working agent's queue, and deletes one whose agent Paseo no longer knows", async () => {
    const queue = newQueue();
    await queue.add("owner-1", message_("chat-a"));
    await queue.add("gone-1", message_("chat-b"));
    expect(await queue.sweep(paseo)).toBe(0);
    expect(await queue.queuedAgents()).toEqual(["owner-1"]);
  });
});

describe("turn ends drain the queue (Supervisor.onTurnEnded)", () => {
  const recovery = { onCrash: vi.fn(async () => undefined), recoverLeftovers: async () => 0 } as unknown as Recovery;
  const stats = { turnEnded: async () => undefined, count: async () => undefined, countProject: async () => undefined } as unknown as Stats;
  const completed = { kind: "completed" } as unknown as TurnOutcome;
  const canceled = { kind: "canceled", reason: "interrupted" } as unknown as TurnOutcome;
  const crashed = { kind: "failed", error: { message: "Claude Code process exited with code 1" } } as unknown as TurnOutcome;
  const timeline = [
    { type: "user_message", text: "work", messageId: "taro-1" },
    { type: "assistant_message", text: "Did a step.\n\nworking: on the next one" },
  ] as unknown as TimelineItem[];

  function setUp(role = "owner"): { queue: ChatQueue; supervisor: Supervisor; end: (outcome: TurnOutcome) => Promise<void> } {
    agents = { "agent-1": agent("agent-1", role, "running") };
    const queue = newQueue();
    const supervisor = new Supervisor(state, stats, recovery, queue);
    const hookAgent = { id: "agent-1", parentAgentId: null } as unknown as HookAgent;
    return {
      queue,
      supervisor,
      // Paseo sets the agent idle before it fires the hook (agent-manager.js finalizeForegroundTurn).
      end: async (outcome) => {
        agents["agent-1"]!.status = "idle";
        await supervisor.onTurnEnded(paseo, hookAgent, outcome, timeline, null, undefined);
      },
    };
  }

  async function queueThree(queue: ChatQueue): Promise<void> {
    for (const id of ["chat-a", "chat-b", "chat-c"]) await queue.tell(paseo, live("agent-1"), `words ${id}`, { messageId: id }, false);
  }

  for (const role of ["owner", "manager", "implementer"]) {
    it(`sends three queued messages over three turn ends, in order, each to the idle ${role}`, async () => {
      const { queue, end } = setUp(role);
      await queueThree(queue);
      expect(sent).toEqual([]);
      for (const [index, id] of ["chat-a", "chat-b", "chat-c"].entries()) {
        await end(completed);
        const chat = sent.filter((each) => each.messageId?.startsWith("chat-"));
        expect(chat.map((each) => each.messageId)).toEqual(["chat-a", "chat-b", "chat-c"].slice(0, index + 1));
        expect(chat[index]).toEqual(expect.objectContaining({ text: `words ${id}`, statusAtSend: "idle" }));
      }
      expect(sent.every((each) => each.statusAtSend === "idle")).toBe(true);
      expect(await queue.list("agent-1")).toEqual([]);
    });
  }

  it("sends the queued message instead of the stall nudge, which waits for the next turn end", async () => {
    const { queue, end } = setUp("owner");
    await queue.tell(paseo, live("agent-1"), "a question", { messageId: "chat-a" }, false);
    await end(completed);
    expect(sent.map((each) => each.messageId?.slice(0, 5))).toEqual(["chat-"]);
    await end(completed);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.messageId).toMatch(/^taro-/);
  });

  it("sends nothing on a crash: the recovery restarts the agent", async () => {
    const { queue, end } = setUp("owner");
    await queueThree(queue);
    await end(crashed);
    expect(recovery.onCrash).toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(await ids(queue, "agent-1")).toEqual(["chat-a", "chat-b", "chat-c"]);
  });

  it("sends nothing through handoff and /compact; the reload's turn end drains", async () => {
    const { queue, end } = setUp("owner");
    await queue.tell(paseo, live("agent-1"), "after the compaction", { messageId: "chat-a" }, false);
    records["agent-1"] = AgentStateSchema.parse({ project: "taro", role: "owner", ticket: "TR-9", compaction: "handoff" });
    await end(completed); // the handoff turn: /compact goes next
    await end(canceled); // a cancel during /compact does not drain either
    expect(records["agent-1"]?.compaction).toBe("compacting");
    await end(completed); // /compact: the reload goes next
    expect(sent.some((each) => each.messageId === "chat-a")).toBe(false);
    expect(records["agent-1"]?.compaction).toBe("none");
    await end(completed); // the reload's own turn
    expect(sent.filter((each) => each.messageId === "chat-a")).toEqual([expect.objectContaining({ statusAtSend: "idle" })]);
  });

  it("Send now mid-turn: the cancel it causes does not drain, the next completed turn end does", async () => {
    const { queue, end } = setUp("owner");
    await queueThree(queue);
    await queue.sendNow(paseo, "agent-1", "chat-b");
    expect(sent).toEqual([expect.objectContaining({ messageId: "chat-b", behavior: "interrupt", statusAtSend: "running" })]);
    expect(sent[0]?.text.startsWith(INTERRUPT_NOTE_START)).toBe(true);
    clock += 1_000;
    await end(canceled);
    expect(sent).toHaveLength(1);
    clock += 5_000;
    agents["agent-1"]!.status = "running";
    await end(completed);
    expect(sent.map((each) => each.messageId)).toEqual(["chat-b", "chat-a"]);
    expect(sent[1]).toEqual(expect.objectContaining({ statusAtSend: "idle", behavior: "steer" }));
    expect(await ids(queue, "agent-1")).toEqual(["chat-c"]);
  });

  it("drains on a canceled turn end the user caused (stop), outside any Send now", async () => {
    const { queue, end } = setUp("manager");
    await queue.tell(paseo, live("agent-1"), "after the stop", { messageId: "chat-a" }, false);
    await end(canceled);
    expect(sent.map((each) => each.messageId)).toEqual(["chat-a"]);
  });
});

describe("the queue's contracts", () => {
  it("have wire names Paseo takes, and list without attachment data", () => {
    for (const contract of [listChatQueue, takeQueuedMessage, sendQueuedMessageNow, retryQueuedMessage]) expect(contract.name).toMatch(/^[a-z][a-z0-9._-]*$/);
    expect([listChatQueue.name, takeQueuedMessage.name, sendQueuedMessageNow.name, retryQueuedMessage.name]).toEqual(["taro.queue.list", "taro.queue.take", "taro.queue.send-now", "taro.queue.retry"]);
    const listed = { id: "chat-a", text: "x", at: "2026-10-16T10:00:00.000Z", imageCount: 1, fileNames: ["a.txt"], failed: null };
    expect(listChatQueue.output.parse({ messages: [listed] })).toEqual({ messages: [listed] });
    expect(takeQueuedMessage.output.parse({ text: "x", images: [IMAGE], files: [FILE] })).toEqual({ text: "x", images: [IMAGE], files: [FILE] });
  });
});
