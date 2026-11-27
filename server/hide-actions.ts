/** Hide for now and Resume (TR-293): what the buttons and `taro ticket hide|unhide` ask of the daemon. Nothing here touches an owner or a ticket file. */
import { waitingOnUser } from "../shared/board";
import { hiddenKey, QUESTION_FINGERPRINT, ticketFingerprint } from "../shared/hidden";
import { findDecision, invalidateBoards, loadBoard } from "./board";
import { hideEntry, unhideEntry } from "./hidden";
import type { PaseoApi } from "./host-types";
import type { PluginState } from "./state";

export async function hideTicket(paseo: PaseoApi, state: PluginState, project: string, ticket: string): Promise<void> {
  // A fresh read, so the fingerprint is of what the user saw on the card, not of a moment before.
  invalidateBoards();
  const board = await loadBoard(paseo, state, project);
  const card = board.cards.find((each) => each.id === ticket);
  if (card === undefined) {
    if (board.hidden.some((item) => item.kind === "ticket" && item.id === ticket)) return;
    throw new Error(`${ticket} is not in Needs you, so there is nothing to hide.`);
  }
  if (!card.hideable) throw new Error(`${ticket} cannot be hidden: it is ${card.column === "needs-you" ? "waiting on a permission you have to answer" : "not in Needs you"}.`);
  const fingerprint = ticketFingerprint({ status: card.status, questionKeys: waitingOnUser(card.decisions).map((decision) => decision.key), lastState: card.lastStatus?.state ?? null });
  await hideEntry(project, { key: hiddenKey("ticket", ticket), at: new Date().toISOString(), fingerprint });
  invalidateBoards();
}

export async function hideQuestion(state: PluginState, project: string, key: string): Promise<void> {
  const decision = await findDecision(state, key);
  if (decision === null || decision.status !== "open" || decision.project !== project || decision.ticket !== null) {
    throw new Error("That question is not one of the manager's open questions in Needs you, so there is nothing to hide.");
  }
  await hideEntry(project, { key: hiddenKey("question", key), at: new Date().toISOString(), fingerprint: QUESTION_FINGERPRINT });
  invalidateBoards();
}

/** Brings an item back; resuming one that is not hidden (it came back by itself) is not an error. */
export async function resumeHidden(project: string, kind: "ticket" | "question", id: string): Promise<void> {
  await unhideEntry(project, hiddenKey(kind, id));
  invalidateBoards();
}
