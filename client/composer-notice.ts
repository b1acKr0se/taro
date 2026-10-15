/**
 * The line above a chat's reply box saying what Send will do when it is not a plain send (TR-084,
 * TR-102), and the matching send button label and held mark. Pure, for vitest.
 */
import type { HoldReason } from "../shared/pending-sends";

export interface ComposerNotice {
  text: string;
  sendLabel: string;
}

/**
 * `holds`: why Send holds a message; `requestPending`: the agent waits on a permission or a question,
 * which a message answers with a refusal (Paseo: "A typed or spoken message from the human answers any
 * permission the agent is blocked on").
 */
export function composerNotice(holds: HoldReason | null, requestPending: boolean): ComposerNotice | null {
  if (holds === "compacting") return { text: "It is compacting its context, and a message now would cancel that, so Send holds your message until it ends.", sendLabel: "Hold until it has compacted" };
  if (holds === "replaces") return { text: "Sending now would stop its current step, so Send holds your message until the step ends.", sendLabel: "Hold until its step ends" };
  if (requestPending) return { text: "Sending a message now turns down the request above. Answer it first to keep it.", sendLabel: "Send and turn down the request" };
  return null;
}

/** What a held message's mark says, by why it is held. */
export function heldMarkText(holds: HoldReason | null): string {
  return holds === "compacting" ? "Held until it has compacted" : "Held until its current step ends";
}
