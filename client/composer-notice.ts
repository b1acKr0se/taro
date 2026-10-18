/**
 * The line above a chat's reply box saying what Send will do when it is not a plain send (TR-084),
 * and the send button's label (TR-171). Pure, for vitest.
 */

/**
 * `requestPending`: the agent waits on a permission or a question, which a message answers with a
 * refusal (Paseo: "A typed or spoken message from the human answers any permission the agent is
 * blocked on"); such a message goes at once, even mid-turn.
 */
export function composerNotice(requestPending: boolean): string | null {
  return requestPending ? "Sending a message now turns down the request above. Answer it first to keep it." : null;
}

/** What Send does: queue the message on the daemon while the agent works, unless it answers a pending request. */
export function sendLabel(agent: { working: boolean; requestPending: boolean }): string {
  if (agent.requestPending) return "Send and turn down the request";
  return agent.working ? "Add to queue" : "Send";
}

/** Whether the box holds something to send: words other than blanks, or an attachment. */
export function hasSomethingToSend(text: string, attachments: number): boolean {
  return text.trim() !== "" || attachments > 0;
}

/**
 * The composer's round button (TR-181), Paseo's `resolvePrimaryActionKind`: something to send keeps it
 * Send; an empty box while the agent works makes it Stop; otherwise Send, dimmed.
 */
export function primaryAction(box: { sendable: boolean; stoppable: boolean }): "send" | "stop" {
  return !box.sendable && box.stoppable ? "stop" : "send";
}
