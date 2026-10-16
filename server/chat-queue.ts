/**
 * The chat queue on the daemon (TR-171): a Taro chat's message to an agent that is working is kept
 * here, one file per agent under the plugin's data directory, attachments included, and sent as the
 * agent's next prompt once it is idle: at its turn end, or by the sweep for a turn end the plugin did
 * not see (it was down, or reloading). So a queued message goes whether or not the app is open.
 *
 * Two locks per agent: the file's, for each read-change-write, and the sender's, held across a send,
 * so a drain, Send now, Edit and Retry never act on the same message at once.
 */
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { attachmentProblem } from "../shared/attachments";
import {
  ChatQueueFileSchema,
  drainBlocker,
  routeChatMessage,
  summarize,
  sweepDue,
  withFront,
  withInterruptNote,
  withQueued,
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
import { serialized } from "./serialize";
import type { PluginState } from "./state";
import { sendWithAttachments, type Attachments } from "./uploads";

const NOT_QUEUED = "That message is no longer queued: it was sent, or taken back to edit.";

export interface ChatQueueOptions {
  /** Where the queue files are; read on each use, as `PASEO_HOME` is. */
  directory?: () => string;
  now?: () => number;
}

export class ChatQueue {
  /** When Send now last interrupted each agent: in memory, as a reload ends the turn it guards anyway. */
  private readonly sendNowAt = new Map<string, number>();
  private readonly directory: () => string;
  private readonly now: () => number;

  constructor(
    private readonly state: Pick<PluginState, "agent">,
    options: ChatQueueOptions = {},
  ) {
    this.directory = options.directory ?? (() => dataPath("chat-queue"));
    this.now = options.now ?? Date.now;
  }

  private path(agentId: string): string {
    return join(this.directory(), `${encodeURIComponent(agentId)}.json`);
  }

  /** The agent's queue, oldest first; a file that cannot be read or parsed counts as empty. */
  async messages(agentId: string): Promise<QueuedMessage[]> {
    const raw = await readJsonIfPresent(this.path(agentId)).catch((error: unknown) => {
      console.warn(`[taro] ${agentId}'s chat queue cannot be read, so it counts as empty: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (raw === null) return [];
    const parsed = ChatQueueFileSchema.safeParse(raw);
    if (!parsed.success) console.warn(`[taro] ${agentId}'s chat queue file is not one this version reads, so it counts as empty`);
    return parsed.success ? parsed.data.messages : [];
  }

  private change<T>(agentId: string, edit: (messages: QueuedMessage[]) => { messages: QueuedMessage[]; result: T }): Promise<T> {
    return serialized(`chat-queue:${agentId}`, async () => {
      const { messages, result } = edit(await this.messages(agentId));
      if (messages.length === 0) await rm(this.path(agentId), { force: true });
      else await writeJsonAtomically(this.path(agentId), { version: 1, messages });
      return result;
    });
  }

  private sending<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    return serialized(`chat-queue-send:${agentId}`, task);
  }

  async list(agentId: string): Promise<QueuedMessageSummary[]> {
    return (await this.messages(agentId)).map(summarize);
  }

  /** Adds the message at the back; one already queued under its id stays as it is. */
  add(agentId: string, queued: QueuedMessage): Promise<void> {
    return this.change(agentId, (messages) => ({ messages: withQueued(messages, queued), result: undefined }));
  }

  private remove(agentId: string, messageId: string): Promise<QueuedMessage> {
    return this.change(agentId, (messages) => {
      const found = messages.find((queued) => queued.id === messageId);
      if (found === undefined) throw new Error(NOT_QUEUED);
      return { messages: messages.filter((queued) => queued.id !== messageId), result: found };
    });
  }

  private markFailed(agentId: string, messageId: string, reason: string | null): Promise<void> {
    return this.change(agentId, (messages) => {
      if (!messages.some((queued) => queued.id === messageId)) throw new Error(NOT_QUEUED);
      return { messages: messages.map((queued) => (queued.id === messageId ? { ...queued, failed: reason } : queued)), result: undefined };
    });
  }

  /** An archived agent's queue goes with it. */
  async forget(agentId: string): Promise<void> {
    this.sendNowAt.delete(agentId);
    await serialized(`chat-queue:${agentId}`, () => rm(this.path(agentId), { force: true }));
  }

  /** The agents with a queue file. */
  async queuedAgents(): Promise<string[]> {
    const names = await readdir(this.directory()).catch(() => [] as string[]);
    return names.filter((name) => name.endsWith(".json")).map((name) => decodeURIComponent(name.slice(0, -".json".length)));
  }

  /**
   * A chat message: sent at once to an idle agent (or one whose pending request it answers), as before;
   * queued while it works. Right after queueing the status is read again: a turn that ended between the
   * first look and the write has already had its drain, so this one sends it.
   */
  async tell(paseo: PaseoApi, agent: PaseoAgent, words: string, attachments: Attachments, answersRequest: boolean): Promise<{ queued: boolean }> {
    if (routeChatMessage(agent, answersRequest) === "send") {
      await sendWithAttachments(paseo, agent.id, words, { ...attachments, agentMidTurn: isMidTurn(agent) });
      return { queued: false };
    }
    const images = attachments.images ?? [];
    const files = attachments.files ?? [];
    // Refused now, while the user is there, rather than failing at the turn end.
    const problem = attachmentProblem([...images.map((image) => ({ ...image, kind: "image" as const })), ...files]);
    if (problem !== null) throw new Error(problem);
    await this.add(agent.id, { id: attachments.messageId ?? newChatMessageId(), text: words, images, files, at: new Date(this.now()).toISOString(), failed: null });
    await this.drain(paseo, agent.id, "queued");
    return { queued: true };
  }

  /**
   * Sends the front message, alone, as a new prompt to the idle agent; returns whether it sent. It leaves
   * the queue once Paseo took it. A failed send marks it, and it holds everything behind it; a resend of
   * one that did reach Paseo is skipped by `sendChatMessageOnce`'s look at the timeline.
   */
  drain(paseo: PaseoApi, agentId: string, trigger: DrainTrigger): Promise<boolean> {
    return this.sending(agentId, async () => {
      const front = (await this.messages(agentId))[0] ?? null;
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
      try {
        await sendWithAttachments(paseo, agentId, front.text, { images: front.images, files: front.files, messageId: front.id });
      } catch (error: unknown) {
        console.warn(`[taro] ${agentId}: its next queued message was not sent: ${failureReason(error)}`);
        // One that passes by itself (the connection, a restart) is tried again by the sweep; only the rest wait for Retry.
        if (!isPassingFailure(error)) await this.markFailed(agentId, front.id, failureReason(error)).catch(() => undefined);
        return false;
      }
      await this.remove(agentId, front.id).catch(() => undefined);
      return true;
    });
  }

  /**
   * Send now: that message out of the queue and to the agent at once, interrupting a running turn (with
   * a note to check what the cut-off step left). Refused while Taro compacts the agent, the message left
   * where it is; a failed send puts it back at the front, marked unless the failure passes by itself, and throws.
   */
  sendNow(paseo: PaseoApi, agentId: string, messageId: string): Promise<void> {
    return this.sending(agentId, async () => {
      const live = await fetchLiveAgent(paseo, agentId);
      if (live === null) throw new Error("That agent is no longer running.");
      if (((await this.state.agent(agentId))?.compaction ?? "none") !== "none") {
        throw new Error("It is compacting: the message stays queued and goes when the compaction ends.");
      }
      const taken = await this.remove(agentId, messageId);
      const midTurn = isMidTurn(live);
      // Set before the send: the turn it cuts off may end before the send returns.
      this.sendNowAt.set(agentId, this.now());
      try {
        const words = midTurn ? withInterruptNote(await message(TEMPLATES.interrupted), taken.text) : taken.text;
        await sendWithAttachments(paseo, agentId, words, { images: taken.images, files: taken.files, messageId: taken.id, agentMidTurn: midTurn, interrupt: true });
      } catch (error: unknown) {
        this.sendNowAt.delete(agentId);
        // Refused as Claude compacts, or a failure in passing: back unmarked, to go at the next turn end or sweep.
        const failed = isCompactingRefusal(error) || isPassingFailure(error) ? null : failureReason(error);
        await this.change(agentId, (messages) => ({ messages: withFront(messages, { ...taken, failed }), result: undefined }));
        throw error;
      }
    });
  }

  /** Edit: the message out of the queue, whole, for the composer. */
  take(agentId: string, messageId: string): Promise<Pick<QueuedMessage, "text" | "images" | "files">> {
    return this.sending(agentId, async () => {
      const taken = await this.remove(agentId, messageId);
      return { text: taken.text, images: taken.images, files: taken.files };
    });
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
      const queued = (await this.messages(agentId)).length;
      if (queued === 0) continue;
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
