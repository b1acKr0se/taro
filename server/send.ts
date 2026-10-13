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

import type { PaseoApi } from "./host-types";

type SendOptions = NonNullable<Parameters<ReturnType<PaseoApi["agents"]["ref"]>["send"]>[1]>;

export type SendExtras = Pick<SendOptions, "images" | "attachments" | "messageId">;

export const PLUGIN_MESSAGE_PREFIX = "taro-";

export function isPluginMessageId(messageId: string | undefined): boolean {
  return messageId !== undefined && messageId.startsWith(PLUGIN_MESSAGE_PREFIX);
}

/** The user's words (from the Taro screen), joining a running turn where possible. */
export async function sendWithoutInterrupting(paseo: PaseoApi, agentId: string, text: string, extras: SendExtras = {}): Promise<void> {
  await paseo.agents.ref(agentId).send(text, { ...extras, activeTurnBehavior: "steer" });
}

/** A message the plugin itself writes (nudge, report, reload, correction). */
export async function sendFromPlugin(paseo: PaseoApi, agentId: string, text: string): Promise<void> {
  await sendWithoutInterrupting(paseo, agentId, text, { messageId: `${PLUGIN_MESSAGE_PREFIX}${randomUUID()}` });
}

/** A slash command must be a turn of its own, so it is a plain send, only to an idle agent. */
export async function sendCommand(paseo: PaseoApi, agentId: string, command: string): Promise<void> {
  await paseo.agents.ref(agentId).send(command, { messageId: `${PLUGIN_MESSAGE_PREFIX}${randomUUID()}` });
}
