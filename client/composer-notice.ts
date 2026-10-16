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
