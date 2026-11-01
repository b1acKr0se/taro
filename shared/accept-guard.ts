/**
 * Only the user's Accept closes a delivered ticket (TR-237). An owner went from "can you do the
 * verification?" to an ACCEPTANCE record and Done, with no press: the words were not an Accept.
 * The plugin writes ACCEPTED when Accept is pressed and ACCEPT-HANDOFF when it hands a step it
 * cannot judge to an owner; those, and nothing an owner writes, authorise the owner's ACCEPTANCE
 * and Done. Plain TypeScript with no imports: the `taro` command runs it under Node type stripping.
 */

/** The records an owner may never write: the plugin's proof that the user pressed Accept. */
const PLUGIN_ONLY = /^(?:ACCEPTED|ACCEPT-HANDOFF)\b/;

/** Records that present the work again, after which an earlier hand-off no longer authorises anything. */
const PRESENTS_AGAIN = /^(?:EVIDENCE|CHANGES-REQUESTED|NOT-MERGED|NOT-SYNCED|DELIVERY-ENDED)\b/;

function records(notes: string): string[] {
  return notes
    .split(/\n(?=[A-Z][A-Z-]{2,}\b)/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

/** Whether the plugin handed the ticket's Accept to an owner and the work was not presented again since. */
export function acceptHandedToOwner(notes: string): boolean {
  const all = records(notes);
  const reopened = all.map((record) => /^REOPENED\b/.test(record)).lastIndexOf(true);
  const round = all.slice(reopened + 1);
  for (let index = round.length - 1; index >= 0; index--) {
    const record = round[index] ?? "";
    if (/^ACCEPT-HANDOFF\b/.test(record)) return true;
    if (PRESENTS_AGAIN.test(record) || (/^EXECUTION\b/.test(record) && /review-head/i.test(record))) return false;
  }
  return false;
}

export interface OwnerEdit {
  status: string | undefined;
  appendNotes: readonly string[];
}

export interface GuardedTicket {
  id: string;
  status: string;
  /** A child ticket closes with its owner's say, not the user's. */
  parent: string | null;
  notes: string;
}

/** The reason a command run by an agent may not make this edit, or null. */
export function acceptRefusal(ticket: GuardedTicket, edit: OwnerEdit): string | null {
  const written = edit.appendNotes.map((note) => note.trim());
  if (written.some((record) => PLUGIN_ONLY.test(record))) {
    return `ACCEPTED and ACCEPT-HANDOFF records are the plugin's proof that the user pressed Accept; an agent never writes them.`;
  }
  if (ticket.parent !== null) return null;
  const acceptance = written.some((record) => /^ACCEPTANCE\b/.test(record));
  const closes = edit.status === "Done" && ticket.status !== "Done";
  if (!acceptance && !closes) return null;
  if (acceptHandedToOwner(ticket.notes)) return null;
  return (
    `${ticket.id} has no Accept to act on: only the user's press of Accept on its card records ACCEPTANCE and sets Done. ` +
    `Words in chat, such as "I merged it" or "can you verify?", are not an Accept. Verify, report with the done status line, and wait; ` +
    `if the plugin hands Accept to you, the ticket's ACCEPT-HANDOFF record says so.`
  );
}
