/**
 * Hide for now (TR-293): the user sets a Needs you ticket or the manager's question aside without
 * pausing anyone. Unlike Park, nothing reaches the owner: only the card leaves the column, the counts
 * and the Inbox. An item is hidden while what it waits on is what it was when hidden (its
 * fingerprint); anything new, such as another question or a status change, brings it back. Pure.
 */
import { z } from "zod";

export const HIDDEN_KINDS = ["ticket", "question"] as const;
export type HiddenKind = (typeof HIDDEN_KINDS)[number];

/** What the daemon stores for one hidden item. */
export const HiddenEntrySchema = z.object({
  /** `ticket:<id>` or `question:<decision key>`. */
  key: z.string(),
  /** When it was hidden, an ISO time. */
  at: z.string(),
  /** What the item waited on then: it stays hidden only while this still holds. */
  fingerprint: z.string(),
});
export type HiddenEntry = z.infer<typeof HiddenEntrySchema>;

/** A hidden item as the board lists it: enough to name it and bring it back. */
export const HiddenItemSchema = z.object({
  kind: z.enum(HIDDEN_KINDS),
  /** The ticket id, or the question's key. */
  id: z.string(),
  title: z.string(),
  at: z.string(),
});
export type HiddenItem = z.infer<typeof HiddenItemSchema>;

export function hiddenKey(kind: HiddenKind, id: string): string {
  return `${kind}:${id}`;
}

/** A manager's question waits on nothing that can change: it is hidden until it is answered or withdrawn. */
export const QUESTION_FINGERPRINT = "question";

/**
 * What a ticket in Needs you waits on: its status, the open questions that wait on the user, and the
 * state of its owner's last status line. A new question, a delivery or a new blocked or failed line
 * changes it; a ticket left alone does not.
 */
export function ticketFingerprint(parts: { status: string; questionKeys: readonly string[]; lastState: string | null }): string {
  return JSON.stringify([parts.status, [...parts.questionKeys].sort(), parts.lastState]);
}

/** Whether a stored entry still hides an item whose fingerprint now is `fingerprint`. */
export function stillHides(entry: HiddenEntry, fingerprint: string): boolean {
  return entry.fingerprint === fingerprint;
}

/** The line that opens the Hidden list: what hiding does and when an item comes back. */
export function hiddenSummary(): string {
  return "Hidden for now. A ticket comes back by itself when it has something new for you.";
}
