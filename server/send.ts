/**
 * Talking to an agent without cutting it off where its provider allows:
 * `activeTurnBehavior: "steer"` joins a running turn, or replaces it where the
 * provider cannot take a message mid-turn, and starts a turn on an idle agent.
 * From FirstMate's `server/send.ts` (MIT).
 */
import type { PaseoApi } from "./host-types";

type SendOptions = NonNullable<Parameters<ReturnType<PaseoApi["agents"]["ref"]>["send"]>[1]>;

export type SendExtras = Pick<SendOptions, "images" | "attachments" | "messageId">;

export async function sendWithoutInterrupting(paseo: PaseoApi, agentId: string, text: string, extras: SendExtras = {}): Promise<void> {
  await paseo.agents.ref(agentId).send(text, { ...extras, activeTurnBehavior: "steer" });
}

/** A slash command must be a turn of its own, so it is a plain send, only to an idle agent. */
export async function sendCommand(paseo: PaseoApi, agentId: string, command: string): Promise<void> {
  await paseo.agents.ref(agentId).send(command);
}
