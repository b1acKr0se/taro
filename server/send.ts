/**
 * Talking to an agent without cutting it off where its provider allows:
 * `activeTurnBehavior: "steer"` joins a running turn, or replaces it where the
 * provider cannot take a message mid-turn, and starts a turn on an idle agent.
 * From FirstMate's `server/send.ts` (MIT).
 *
 * The plugin's own messages (nudges, reports, reloads) carry a `taro-` message
 * id, so a message without one in a timeline is the user's own words — typed in
 * the agent's tab or sent from the Taro screen.
 */
import { randomUUID } from "node:crypto";

import { CHAT_MESSAGE_PREFIX, COMPACTING_REFUSAL, isCompacting, type SendTimelineEntry } from "../shared/pending-sends";
import { PLUGIN_MESSAGE_PREFIX, USER_ANSWER_PREFIX } from "../shared/received-message";
import { refusedMessage } from "../shared/refused-commands";
import type { PaseoApi, TimelineItem } from "./host-types";

type SendOptions = NonNullable<Parameters<ReturnType<PaseoApi["agents"]["ref"]>["send"]>[1]>;

export type SendExtras = Pick<SendOptions, "images" | "attachments" | "messageId">;

export { PLUGIN_MESSAGE_PREFIX };

export function isPluginMessageId(messageId: string | undefined): boolean {
  return messageId !== undefined && messageId.startsWith(PLUGIN_MESSAGE_PREFIX);
}

/** The last stop before Paseo for words that are not the plugin's own command: a `/clear` the boxes missed is not sent (TR-232). */
function refuseWipingCommand(text: string): void {
  const refusal = refusedMessage(text);
  if (refusal !== null) throw new Error(refusal);
}

/** The user's words (from the Taro screen), joining a running turn where possible. */
export async function sendWithoutInterrupting(paseo: PaseoApi, agentId: string, text: string, extras: SendExtras = {}): Promise<void> {
  refuseWipingCommand(text);
  await paseo.agents.ref(agentId).send(text, { ...extras, activeTurnBehavior: "steer" });
}

/** Send now (TR-171): the user's queued words cut the running turn off and start a new one, atomically in Paseo. */
export async function sendInterrupting(paseo: PaseoApi, agentId: string, text: string, extras: SendExtras = {}): Promise<void> {
  refuseWipingCommand(text);
  await paseo.agents.ref(agentId).send(text, { ...extras, activeTurnBehavior: "interrupt" });
}

/** A message the plugin itself writes (nudge, report, reload, correction). */
export async function sendFromPlugin(paseo: PaseoApi, agentId: string, text: string): Promise<void> {
  await sendWithoutInterrupting(paseo, agentId, text, { messageId: `${PLUGIN_MESSAGE_PREFIX}${randomUUID()}` });
}

/** The user's answer from a decision card: tagged as the plugin's for supervision (it closes only its own decision), shown as the user's own. */
export async function sendUserAnswer(paseo: PaseoApi, agentId: string, text: string): Promise<void> {
  await sendWithoutInterrupting(paseo, agentId, text, { messageId: `${USER_ANSWER_PREFIX}${randomUUID()}` });
}

/** A slash command must be a turn of its own, so it is a plain send, only to an idle agent. */
export async function sendCommand(paseo: PaseoApi, agentId: string, command: string): Promise<void> {
  await paseo.agents.ref(agentId).send(command, { messageId: `${PLUGIN_MESSAGE_PREFIX}${randomUUID()}` });
}

/** How far back a chat message is looked for before it is sent again: more than a burst of sends and the replies between them. */
const ALREADY_SENT_LOOKBACK = 60;

/** Whether the timeline holds the user's message under this id. */
export function holdsMessage(entries: readonly { item: TimelineItem }[], messageId: string): boolean {
  return entries.some((entry) => entry.item.type === "user_message" && entry.item.clientMessageId === messageId);
}

const chatSendsUnderWay = new Map<string, Promise<void>>();

/**
 * Sends a message from a Taro chat once per message id (TR-102). The chat sends a message again under
 * its own id after a failure (Retry), or after a reconnect or reload while it was on its way: when the
 * first send reached Paseo and only its answer was lost, the message is already in the timeline, or
 * still on its way here, and is not sent twice. A timeline that cannot be read is taken as not holding it.
 * One sent while the agent compacts is handed back unsent (`COMPACTING_REFUSAL`): Paseo would cancel the
 * compaction for it, and the chat holds it until the compaction ends.
 */
export async function sendChatMessageOnce(
  paseo: PaseoApi,
  agentId: string,
  messageId: string | undefined,
  send: () => Promise<void>,
  midTurn = false,
  /** The last look before the send (a queued message's: is the agent still idle?); throws to send nothing. */
  beforeSend: () => Promise<void> = async () => undefined,
): Promise<void> {
  if (messageId === undefined || !messageId.startsWith(CHAT_MESSAGE_PREFIX)) {
    await beforeSend();
    return send();
  }
  const key = `${agentId} ${messageId}`;
  const underWay = chatSendsUnderWay.get(key);
  if (underWay !== undefined) return underWay;
  const sending = (async () => {
    const page = await Promise.resolve()
      .then(() => paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: ALREADY_SENT_LOOKBACK, projection: "projected" }))
      .catch(() => null);
    if (page !== null && holdsMessage(page.entries, messageId)) return;
    if (midTurn && page !== null && isCompacting(page.entries as unknown as readonly SendTimelineEntry[])) throw new Error(COMPACTING_REFUSAL);
    await beforeSend();
    await send();
  })();
  chatSendsUnderWay.set(key, sending);
  try {
    await sending;
  } finally {
    chatSendsUnderWay.delete(key);
  }
}
