/**
 * The chat queue on the daemon (TR-171): a Taro chat's message to an agent that is working is kept
 * here, one file per agent under the plugin's data directory, attachments included, and sent as the
 * agent's next prompt once it is idle: at its turn end, or by the sweep for a turn end the plugin did
 * not see (it was down, or reloading). So a queued message goes whether or not the app is open.
 *
 * Two locks per agent: the file's, for each read-change-write, and the sender's, held across a send,
 * so a drain, Send now, Edit and Retry never act on the same message at once.
 */
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { attachmentProblem } from "../shared/attachments";
import {
  ChatQueueFileSchema,
  drainBlocker,
  NOT_QUEUED,
  routeChatMessage,
  summarize,
  sweepDue,
  withCarried,
  withFront,
  withInterruptNote,
  withQueued,
  withSent,
  type ChatQueueFile,
  type DrainTrigger,
  type QueuedMessage,
  type QueuedMessageSummary,
} from "../shared/chat-queue";
import { failureReason, isCompactingRefusal, isPassingFailure, newChatMessageId } from "../shared/pending-sends";
import { fetchLiveAgent, isAgentGone, isMidTurn } from "./agents";
import { dataPath } from "./data-dir";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { TEMPLATES, message } from "./package-files";
import { holdsMessage } from "./send";
import { serialized } from "./serialize";
import type { PluginState } from "./state";
import { sendWithAttachments, type Attachments } from "./uploads";

/** How far back a tell looks in the agent's timeline for its own message, as `sendChatMessageOnce` does. */
const TIMELINE_LOOKBACK = 60;

/** Thrown by a drain's last look when the agent started a turn after its first: nothing sent, nothing marked. */
const STARTED_A_TURN = "the agent started a turn";

const EMPTY: ChatQueueFile = { messages: [], sent: [] };

export interface ChatQueueOptions {
  /** Where the queue files are; read on each use, as `PASEO_HOME` is. */
  directory?: () => string;
  now?: () => number;
  /** Reads a queue file (tests count the reads). */
  read?: (path: string) => Promise<unknown>;
}

export class ChatQueue {
  /** When Send now last interrupted each agent: in memory, as a reload ends the turn it guards anyway. */
  private readonly sendNowAt = new Map<string, number>();
  /**
   * Each agent's queue as last read or written: this process is the only writer, and every write goes
   * through `change`, `carry` or `claim`, so a poll of the list never reads the attachments again.
   */
  private readonly files = new Map<string, ChatQueueFile>();
  /** Agents being replaced, with the slot their queue goes to: their archive carries it rather than deleting it. */
  private readonly replacing = new Map<string, string>();
  /** Agents with only sent ids left whose being gone the sweep has looked at once. */
  private readonly lookedAt = new Set<string>();
  private readonly directory: () => string;
  private readonly now: () => number;
  private readonly read: (path: string) => Promise<unknown>;

  constructor(
    private readonly state: Pick<PluginState, "agent">,
    options: ChatQueueOptions = {},
  ) {
    this.directory = options.directory ?? (() => dataPath("chat-queue"));
    this.now = options.now ?? Date.now;
    this.read = options.read ?? readJsonIfPresent;
  }

  private path(agentId: string): string {
    return join(this.directory(), `${encodeURIComponent(agentId)}.json`);
  }

  private carriedPath(slot: string): string {
    return join(this.directory(), "carried", `${encodeURIComponent(slot)}.json`);
  }

  /**
   * A queue file, or null when there is none; one that cannot be parsed counts as empty. A read that
   * fails (too many open files, a permission) throws: counted as empty and kept, the next add would
   * write over the real messages.
   */
  private async readFile(path: string, owner: string): Promise<ChatQueueFile | null> {
    const raw = await this.read(path).catch((error: unknown) => {
      if (!(error instanceof SyntaxError)) throw error;
      console.warn(`[taro] ${owner}'s chat queue is not valid JSON, so it counts as empty: ${error.message}`);
      return {};
    });
    if (raw === null) return null;
    const parsed = ChatQueueFileSchema.safeParse(raw);
    if (!parsed.success) console.warn(`[taro] ${owner}'s chat queue file is not one this version reads, so it counts as empty`);
    return parsed.success ? { messages: parsed.data.messages, sent: parsed.data.sent } : EMPTY;
  }

  private async load(agentId: string): Promise<ChatQueueFile> {
    const cached = this.files.get(agentId);
    if (cached !== undefined) return cached;
    const file = (await this.readFile(this.path(agentId), agentId)) ?? EMPTY;
    this.files.set(agentId, file);
    return file;
  }

  /** The agent's queue, oldest first. */
  async messages(agentId: string): Promise<QueuedMessage[]> {
    return [...(await this.load(agentId)).messages];
  }

  /** A file with neither messages nor sent ids is deleted; the sent ids keep one whose queue is empty (TR-171). */
  private async store(path: string, file: ChatQueueFile): Promise<void> {
    if (file.messages.length === 0 && file.sent.length === 0) await rm(path, { force: true });
    else await writeJsonAtomically(path, { version: 1, messages: file.messages, sent: file.sent });
  }

  /** One read-change-write; `edit` answers `file: null` to leave the file as it is. */
  private change<T>(agentId: string, edit: (file: ChatQueueFile) => { file: ChatQueueFile | null; result: T }): Promise<T> {
    return serialized(`chat-queue:${agentId}`, async () => {
      const { file, result } = edit(await this.load(agentId));
      if (file === null) return result;
      try {
        await this.store(this.path(agentId), file);
      } catch (error: unknown) {
        // Read again next time rather than trust a copy the disk may not hold.
        this.files.delete(agentId);
        throw error;
      }
      this.files.set(agentId, file);
      return result;
    });
  }

  private sending<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    return serialized(`chat-queue-send:${agentId}`, task);
  }

  async list(agentId: string): Promise<QueuedMessageSummary[]> {
    return (await this.load(agentId)).messages.map(summarize);
  }

  /** What `taro.queue.list` answers: the summaries, and whether Taro compacts the agent (no Send now then). */
  async listing(agentId: string): Promise<{ messages: QueuedMessageSummary[]; compacting: boolean }> {
    const [messages, known] = await Promise.all([this.list(agentId), this.state.agent(agentId)]);
    return { messages, compacting: (known?.compaction ?? "none") !== "none" };
  }

  /** Adds the message at the back; whether it did. One already queued under its id, or already sent by the queue, is turned away. */
  add(agentId: string, queued: QueuedMessage): Promise<boolean> {
    return this.change(agentId, (file) => {
      if (file.sent.includes(queued.id) || file.messages.some((each) => each.id === queued.id)) return { file: null, result: false };
      return { file: { ...file, messages: withQueued(file.messages, queued) }, result: true };
    });
  }

  /** Edit's second step: the message out of the queue; "no longer queued" when it was sent (or taken) meanwhile. */
  remove(agentId: string, messageId: string): Promise<void> {
    return this.sending(agentId, () =>
      this.change(agentId, (file) => {
        if (!file.messages.some((queued) => queued.id === messageId)) throw new Error(NOT_QUEUED);
        return { file: { ...file, messages: file.messages.filter((queued) => queued.id !== messageId) }, result: undefined };
      }),
    );
  }

  /** A message Paseo took: out of the queue, its id kept among the sent. */
  private removeSent(agentId: string, messageId: string): Promise<void> {
    return this.change(agentId, (file) => ({ file: { messages: file.messages.filter((queued) => queued.id !== messageId), sent: withSent(file.sent, messageId) }, result: undefined }));
  }

  private markFailed(agentId: string, messageId: string, reason: string | null): Promise<void> {
    return this.change(agentId, (file) => {
      if (!file.messages.some((queued) => queued.id === messageId)) throw new Error(NOT_QUEUED);
      return { file: { ...file, messages: file.messages.map((queued) => (queued.id === messageId ? { ...queued, failed: reason } : queued)) }, result: undefined };
    });
  }

  /** An archived agent's queue goes with it; one being replaced goes to its replacement instead. */
  async forget(agentId: string): Promise<void> {
    const slot = this.replacing.get(agentId);
    if (slot !== undefined) return this.carry(agentId, slot);
    this.sendNowAt.delete(agentId);
    await serialized(`chat-queue:${agentId}`, async () => {
      await rm(this.path(agentId), { force: true });
      this.files.delete(agentId);
    });
  }

  /**
   * An agent about to be archived for a replacement (a fresh manager, a relaunched owner): its queue,
   * attachments, failed marks and sent ids, moves to the role's carried slot, by a rename, before the
   * archive; the replacement claims it once started. A plugin that dies in between leaves it in the
   * slot for the next start of that role. Called again after the archive, for a message that came in
   * between; until the claim, the archive hook carries rather than deletes.
   */
  async carry(agentId: string, slot: string): Promise<void> {
    this.replacing.set(agentId, slot);
    // Under the sender's lock, so a drain under way finishes first and none starts on the old agent.
    await this.sending(agentId, () =>
      serialized(`chat-queue:${agentId}`, () =>
        serialized(`chat-queue-carried:${slot}`, async () => {
          const file = await this.load(agentId);
          if (file.messages.length === 0 && file.sent.length === 0) return;
          const carriedPath = this.carriedPath(slot);
          await mkdir(join(this.directory(), "carried"), { recursive: true });
          const carried = await this.readFile(carriedPath, slot);
          // Joined in the agent's own file first, so the rename that follows moves the whole queue at once.
          if (carried !== null) await this.store(this.path(agentId), withCarried(carried, file));
          await rename(this.path(agentId), carriedPath);
          this.files.set(agentId, EMPTY);
          console.log(`[taro] carried ${agentId}'s chat queue (${file.messages.length} message(s)) for its replacement`);
        }),
      ),
    );
  }

  /** The replacement started: the role's carried queue becomes its own, ahead of anything queued to it already. Returns how many messages came. */
  async claim(slot: string, agentId: string): Promise<number> {
    for (const [replaced, each] of [...this.replacing]) if (each === slot) this.replacing.delete(replaced);
    return serialized(`chat-queue:${agentId}`, () =>
      serialized(`chat-queue-carried:${slot}`, async () => {
        const carriedPath = this.carriedPath(slot);
        const carried = await this.readFile(carriedPath, slot);
        if (carried === null) return 0;
        const current = await this.load(agentId);
        const joined = withCarried(carried, current);
        if (current.messages.length > 0 || current.sent.length > 0) await this.store(carriedPath, joined);
        await rename(carriedPath, this.path(agentId));
        this.files.set(agentId, joined);
        if (carried.messages.length > 0) console.log(`[taro] ${agentId} took over ${carried.messages.length} queued chat message(s) from the agent it replaced`);
        return carried.messages.length;
      }),
    );
  }

  /** The agents with a queue file. */
  async queuedAgents(): Promise<string[]> {
    const names = await readdir(this.directory()).catch(() => [] as string[]);
    return names.filter((name) => name.endsWith(".json")).map((name) => decodeURIComponent(name.slice(0, -".json".length)));
  }

  /**
   * Whether the agent has messages that will go at its next turn end (an owner's subagent reports wait
   * behind them, TR-171). A front marked Not sent waits for the user's Retry or Edit, so it holds nothing.
   */
  async hasQueued(agentId: string): Promise<boolean> {
    const front = (await this.load(agentId)).messages[0];
    return front !== undefined && front.failed === null;
  }

  /** Whether the agent's recent timeline holds the message; a timeline that cannot be read does not. */
  private async inTimeline(paseo: PaseoApi, agentId: string, messageId: string): Promise<boolean> {
    const page = await Promise.resolve()
      .then(() => paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: TIMELINE_LOOKBACK, projection: "projected" }))
      .catch(() => null);
    return page !== null && holdsMessage(page.entries, messageId);
  }

  /**
   * A chat message: sent at once to an idle agent with nothing queued (or one whose pending request it
   * answers), as before; queued while it works, or behind messages already waiting. A tell retried after
   * its answer was lost is turned away when the queue sent it already or the agent's timeline holds it.
   * Right after queueing the status is read again: a turn that ended between the first look and the
   * write has already had its drain, so this one sends it.
   */
  async tell(paseo: PaseoApi, agent: PaseoAgent, words: string, attachments: Attachments, answersRequest: boolean): Promise<{ queued: boolean }> {
    const file = await this.load(agent.id);
    if (attachments.messageId !== undefined && file.sent.includes(attachments.messageId)) return { queued: true };
    if (routeChatMessage(agent, answersRequest, file.messages.length) === "send") {
      await sendWithAttachments(paseo, agent.id, words, { ...attachments, agentMidTurn: isMidTurn(agent) });
      return { queued: false };
    }
    const images = attachments.images ?? [];
    const files = attachments.files ?? [];
    // Refused now, while the user is there, rather than failing at the turn end.
    const problem = attachmentProblem([...images.map((image) => ({ ...image, kind: "image" as const })), ...files]);
    if (problem !== null) throw new Error(problem);
    const messageId = attachments.messageId ?? newChatMessageId();
    // Under the sender's lock, so a drain's send and its sent id land before or after this look, never across it.
    await this.sending(agent.id, async () => {
      if (attachments.messageId !== undefined && (await this.inTimeline(paseo, agent.id, messageId))) return;
      await this.add(agent.id, { id: messageId, text: words, images, files, at: new Date(this.now()).toISOString(), failed: null });
    });
    await this.drain(paseo, agent.id, "queued");
    return { queued: true };
  }

  /**
   * Sends the front message, alone, as a new prompt to the idle agent; returns whether it sent. It leaves
   * the queue once Paseo took it. The agent's status is read again right before the send, after the
   * timeline's, so a turn started in between is never joined. A failed send marks it, and it holds
   * everything behind it; a resend of one that did reach Paseo is skipped by `sendChatMessageOnce`'s look
   * at the timeline.
   */
  drain(paseo: PaseoApi, agentId: string, trigger: DrainTrigger): Promise<boolean> {
    return this.sending(agentId, async () => {
      const front = (await this.load(agentId)).messages[0] ?? null;
      if (front === null) return false;
      const live = await fetchLiveAgent(paseo, agentId);
      const known = live === null ? null : await this.state.agent(agentId);
      const blocker = drainBlocker({
        trigger,
        status: live?.status ?? null,
        compaction: known?.compaction ?? "none",
        front,
        sendNowAt: this.sendNowAt.get(agentId) ?? null,
        now: this.now(),
      });
      if (blocker !== null) return false;
      const stillIdle = async () => {
        const again = await fetchLiveAgent(paseo, agentId);
        if (again === null || isMidTurn(again)) throw new Error(STARTED_A_TURN);
      };
      try {
        await sendWithAttachments(paseo, agentId, front.text, { images: front.images, files: front.files, messageId: front.id, beforeSend: stillIdle });
      } catch (error: unknown) {
        // Its turn end drains it.
        if (error instanceof Error && error.message === STARTED_A_TURN) return false;
        console.warn(`[taro] ${agentId}: its next queued message was not sent: ${failureReason(error)}`);
        // One that passes by itself (the connection, a restart) is tried again by the sweep; only the rest wait for Retry.
        if (!isPassingFailure(error)) await this.markFailed(agentId, front.id, failureReason(error)).catch(() => undefined);
        return false;
      }
      await this.removeSent(agentId, front.id).catch(() => undefined);
      return true;
    });
  }

  /**
   * Send now: that message to the agent at once, interrupting a running turn (with a note to check what
   * the cut-off step left); it leaves the queue only once Paseo took it, so a plugin that dies mid-send
   * keeps it. Refused while Taro compacts the agent, the message left where it is; a failed send puts it
   * at the front, marked unless the failure passes by itself, and throws.
   */
  sendNow(paseo: PaseoApi, agentId: string, messageId: string): Promise<void> {
    return this.sending(agentId, async () => {
      const live = await fetchLiveAgent(paseo, agentId);
      if (live === null) throw new Error("That agent is no longer running.");
      if (((await this.state.agent(agentId))?.compaction ?? "none") !== "none") {
        throw new Error("It is compacting: the message stays queued and goes when the compaction ends.");
      }
      const queued = (await this.load(agentId)).messages.find((each) => each.id === messageId);
      if (queued === undefined) throw new Error(NOT_QUEUED);
      const midTurn = isMidTurn(live);
      // Set before the send: the turn it cuts off may end before the send returns.
      this.sendNowAt.set(agentId, this.now());
      try {
        const words = midTurn ? withInterruptNote(await message(TEMPLATES.interrupted), queued.text) : queued.text;
        await sendWithAttachments(paseo, agentId, words, { images: queued.images, files: queued.files, messageId: queued.id, agentMidTurn: midTurn, interrupt: true });
      } catch (error: unknown) {
        this.sendNowAt.delete(agentId);
        // Refused as Claude compacts, or a failure in passing: at the front unmarked, to go at the next turn end or sweep.
        const failed = isCompactingRefusal(error) || isPassingFailure(error) ? null : failureReason(error);
        await this.change(agentId, (file) => ({ file: { ...file, messages: withFront(file.messages, { ...queued, failed }) }, result: undefined }));
        throw error;
      }
      await this.removeSent(agentId, messageId).catch(() => undefined);
    });
  }

  /** Edit's first step: the message, whole, for the composer; it stays queued until `remove`, so a lost answer loses nothing. */
  async take(agentId: string, messageId: string): Promise<Pick<QueuedMessage, "text" | "images" | "files">> {
    const queued = (await this.load(agentId)).messages.find((each) => each.id === messageId);
    if (queued === undefined) throw new Error(NOT_QUEUED);
    return { text: queued.text, images: queued.images, files: queued.files };
  }

  /** Retry: clears the message's failed mark, then drains. */
  async retry(paseo: PaseoApi, agentId: string, messageId: string): Promise<boolean> {
    await this.sending(agentId, () => this.markFailed(agentId, messageId, null));
    return this.drain(paseo, agentId, "retry");
  }

  /**
   * Drains each queue whose agent is idle and has been for `SWEEP_AFTER_MS`; returns how many it sent.
   * A queue whose agent Paseo no longer knows (archived while the plugin was down) is deleted.
   */
  async sweep(paseo: PaseoApi): Promise<number> {
    let sent = 0;
    for (const agentId of await this.queuedAgents()) {
      const queued = (await this.load(agentId)).messages.length;
      if (queued === 0) {
        // Only sent ids left: deleted once, if its agent is gone.
        if (!this.lookedAt.has(agentId)) {
          this.lookedAt.add(agentId);
          if (await isAgentGone(paseo, agentId).catch(() => false)) await this.forget(agentId);
        }
        continue;
      }
      const live = await fetchLiveAgent(paseo, agentId);
      if (live === null) {
        if (await isAgentGone(paseo, agentId).catch(() => false)) await this.forget(agentId);
        continue;
      }
      const known = await this.state.agent(agentId);
      const idleSince = latest(known?.lastTurnEndedAt ?? null, live.updatedAt ?? null);
      if (!sweepDue({ queued, status: live.status, idleSince, now: this.now() })) continue;
      if (await this.drain(paseo, agentId, "sweep")) sent += 1;
    }
    return sent;
  }
}

/** The later of two ISO times; either may be missing. */
function latest(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
