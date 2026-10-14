import { z } from "zod";

import { noteRecords } from "./execution";

export const MilestoneSchema = z.object({
  kind: z.string(),
  time: z.string().nullable(),
  text: z.string(),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

/** The board card's latest milestone is cut here; the Ticket tab shows a record whole when tapped. */
const MAX_TEXT = 200;

// Owners write these by hand: the time is optional and the separator is an em dash, a hyphen or a colon.
const RECORD = /^([A-Z][A-Z-]{2,})\b(?:[ \t]+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?))?[ \t]*(?:—|-|:)?([\s\S]*)$/;

function milestoneOf(record: string): Milestone | null {
  const match = RECORD.exec(record);
  if (match === null) return null;
  return { kind: match[1] ?? "", time: match[2] ?? null, text: (match[3] ?? "").replace(/\s+/g, " ").trim() };
}

/** The records the skill and the plugin write; any other name needs a time to count as a record. */
export const RECORD_KINDS: ReadonlySet<string> = new Set([
  "MILESTONE",
  "EXECUTION",
  "APPROVAL",
  "REVIEW",
  "FINAL",
  "ACCEPTANCE",
  "RECOVERY",
  "ANSWER",
  "HANDOFF",
  "DISPATCH-INTENT",
]);

/** Every record in a ticket's notes, whole, in note order (notes are append-only, so oldest first). */
export function ticketMilestones(notes: string | null): Milestone[] {
  // A body line opening with capitals ("README updated") splits off as a record; join it back.
  const records: string[] = [];
  for (const record of noteRecords(notes)) {
    const milestone = milestoneOf(record);
    const continuation = milestone !== null && milestone.time === null && !RECORD_KINDS.has(milestone.kind);
    if (continuation && records.length > 0) records[records.length - 1] += `\n${record}`;
    else records.push(record);
  }
  return records.flatMap((record) => {
    const milestone = milestoneOf(record);
    return milestone === null ? [] : [milestone];
  });
}

/** The newest MILESTONE record, or null when the owner has written none. */
export function latestMilestone(notes: string | null): Milestone | null {
  const milestones = ticketMilestones(notes).filter((milestone) => milestone.kind === "MILESTONE");
  const latest = milestones[milestones.length - 1];
  if (latest === undefined) return null;
  return latest.text.length > MAX_TEXT ? { ...latest, text: `${latest.text.slice(0, MAX_TEXT - 1)}…` } : latest;
}

/** A record's kind in plain words: "Dispatch intent" for DISPATCH-INTENT. */
export function kindLabel(kind: string): string {
  const words = kind.toLowerCase().replace(/[-_]+/g, " ").trim();
  return words === "" ? kind : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
