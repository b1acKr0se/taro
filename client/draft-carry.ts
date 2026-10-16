/**
 * Moves a composer's unsent words and attachments from one agent to another: a replaced manager's
 * to the fresh one (TR-161), so what the user typed before replacing waits in the new box.
 */
import type { AttachmentDraftStore } from "./draft-attachments";
import type { DraftStore } from "./draft";

export function carryDraft(stores: { text: DraftStore; attachments: AttachmentDraftStore }, from: string, to: string): void {
  if (from === to) return;
  const text = stores.text.get(from);
  const attachments = stores.attachments.get(from);
  // What the new box already holds stays ahead of what is carried; the old box is emptied.
  if (text !== "") stores.text.set(to, [stores.text.get(to), text].filter((part) => part !== "").join("\n\n"));
  if (attachments.length > 0) stores.attachments.set(to, [...stores.attachments.get(to), ...attachments]);
  stores.text.set(from, "");
  stores.attachments.set(from, []);
}
