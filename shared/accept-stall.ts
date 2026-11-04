/**
 * An Accept hand-off whose owner ends its turn without finishing (TR-256): the user accepted, the
 * plugin's merge stopped, and the owner it handed the merge to went idle with the pull request still
 * open. Nothing retried, and the ticket sat in Awaiting acceptance with no card. Pure.
 */
import { roundRecords } from "./execution";

/** Records that end or restart a delivery: after one of these, a hand-off is no longer the newest word. */
const ENDS_HANDOFF = /^(?:ACCEPTANCE|NOT-MERGED|NOT-SYNCED|CHANGES-REQUESTED|DELIVERY-ENDED|ACCEPTED|EVIDENCE)\b/;

/** Whether the newest Accept record is an ACCEPT-HANDOFF: the merge was given to an owner and nothing has closed or reopened it. */
export function acceptHandoffOpen(notes: string | null): boolean {
  const records = roundRecords(notes);
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index] ?? "";
    if (/^ACCEPT-HANDOFF\b/.test(record)) return true;
    if (ENDS_HANDOFF.test(record)) return false;
  }
  return false;
}

/** Turns in a row an owner may end with its hand-off open before the user is asked, the plugin having told it each time. */
export const ACCEPT_STALL_LIMIT = 3;

/** The NOT-MERGED reason when the hand-off owner keeps ending without merging: back to the user, Accept offered again. */
export function acceptStallReason(turns: number, pullRequest: string): string {
  return `the owner the plugin handed the merge to ended ${turns} turns without finishing it; ${pullRequest}. Press Accept to try the merge again, or ask for changes`;
}
