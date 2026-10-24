/**
 * Reopen (TR-229): a Done ticket goes back to Queued with the user's note, and a fresh owner works a
 * new round on the same ticket. The notes are append-only, so the earlier rounds stay as history;
 * every reader of delivery state (accepted, merged, evidence, review head, plan approval, pause)
 * reads only the round in progress: the notes from the latest REOPENED record on. Pure and
 * import-free, so `shared/execution.ts` can scope its readers without an import cycle.
 */

export interface ReopenFacts {
  status: string;
  parent: string | null;
  note: string;
}

/** Why Reopen is refused for this ticket, in the user's words; null when it may be reopened. */
export function reopenRefusal(ticket: string, facts: ReopenFacts): string | null {
  if (facts.parent !== null) return `${ticket} is part of ${facts.parent}; reopen ${facts.parent} instead.`;
  if (facts.status !== "Done") return `${ticket} is ${facts.status}: only a Done ticket can be reopened.`;
  if (facts.note.trim() === "") return "Say what the owner should do first.";
  return null;
}

// A record starts a line with its upper-case name, as `noteRecords` splits them.
const REOPENED = /(?:^|\n)REOPENED\b/g;

/** The notes of the round in progress: from the latest REOPENED record on, or the whole notes when there is none. */
export function currentRound(notes: string | null): string | null {
  if (notes === null) return null;
  const starts = [...notes.matchAll(REOPENED)];
  const last = starts[starts.length - 1];
  if (last === undefined) return notes;
  return notes.slice((last.index ?? 0) + (last[0].startsWith("\n") ? 1 : 0));
}

/**
 * What the readers of delivery state read: the current round's records after its REOPENED record,
 * whose quoted note and earlier FINAL (with its PR and review head) belong to the round before.
 */
export function roundNotes(notes: string | null): string | null {
  const round = currentRound(notes);
  if (round === null || reopenRound(notes) === 1) return round;
  const next = round.search(/\n(?=[A-Z][A-Z-]{2,}\b)/);
  return next === -1 ? "" : round.slice(next + 1);
}

/** The round a reopened ticket is in: 1 before any REOPENED record, then one more for each. */
export function reopenRound(notes: string | null): number {
  return 1 + (notes === null ? 0 : [...notes.matchAll(REOPENED)].length);
}

/** The branch a round works on: the ticket's own for the first, `taro/<id>-<round>` after a reopen, so a new name never meets the merged one. */
export function roundBranch(ticket: string, round: number): string {
  const base = `taro/${ticket.toLowerCase()}`;
  return round <= 1 ? base : `${base}-${round}`;
}

function indented(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : `  ${line}`))
    .join("\n");
}

/**
 * The REOPENED record. The note and the earlier FINAL keep their lines indented, so none of them
 * reads as a record of its own (a line starting with capitals would), and a reader of the new
 * round never meets the old summary's PR or review head as a record.
 */
export function reopenedRecordText(input: { at: string; note: string; round: number; pastOwners: readonly string[]; finalSummary: string | null }): string {
  const note = indented(input.note.trim()).trimStart();
  const owners = input.pastOwners.length === 0 ? "none" : input.pastOwners.join(", ");
  const record = `REOPENED ${input.at} — user: "${note}"; round ${input.round}; past owners: ${owners}`;
  const summary = input.finalSummary?.trim() ?? "";
  return summary === "" ? record : `${record}\nprevious FINAL:\n${indented(summary)}`;
}

export interface CloseRoundFacts {
  status: string;
  parent: string | null;
  /** `reopenRound` of the ticket's notes. */
  round: number;
}


/**
 * Why Close round is refused for this ticket, in the user's words; null when it may be closed: a
 * reopened top-level ticket not yet delivered, in any other status (a parked one too, as parking
 * keeps the status). Awaiting acceptance has Accept and Request changes instead.
 */
export function closeRoundRefusal(ticket: string, facts: CloseRoundFacts): string | null {
  if (facts.parent !== null) return `${ticket} is part of ${facts.parent}; close ${facts.parent}'s round instead.`;
  if (facts.round <= 1) return `${ticket} was never reopened: there is no round to close.`;
  if (facts.status === "Awaiting acceptance") return `${ticket} is awaiting your acceptance: accept it or request changes instead.`;
  if (facts.status === "Done" || facts.status === "Cancelled") return `${ticket} is ${facts.status}: its round is over.`;
  return null;
}

/** The ROUND-CLOSED record: the user ended the round before its owner delivered, so nothing of it was merged. */
export function roundClosedRecordText(input: { at: string; round: number; reason: string; branch: string | null }): string {
  const reason = input.reason.trim();
  const quoted = reason === "" ? "" : `: "${indented(reason).trimStart()}"`;
  const branch = input.branch === null ? "" : `; branch ${input.branch} kept unmerged`;
  return `ROUND-CLOSED ${input.at} — round ${input.round} closed by the user${quoted}; nothing from this round was merged${branch}`;
}
