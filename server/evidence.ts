/**
 * Judges a ticket's EVIDENCE record against the files in its evidence folder
 * (`<plugin data>/evidence/<project>/<TICKET-ID>/`), for the board, the Ticket tab,
 * the Accept guard and the owner's reminder.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { EvidenceView } from "../shared/contracts";
import { judgeEvidence, parseEvidence, type ParsedEvidence } from "../shared/evidence";
import { evidenceDirectory } from "./data-dir";

export function projectEvidenceDirectory(project: string): string {
  return join(evidenceDirectory(), project);
}

export function ticketEvidenceDirectory(project: string, ticket: string): string {
  return join(projectEvidenceDirectory(project), ticket);
}

async function filesIn(directory: string): Promise<Set<string>> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
}

export async function judgeTicketEvidence(project: string, ticket: string, parsed: ParsedEvidence | null, investigation: boolean, accepted = false): Promise<EvidenceView> {
  const folder = ticketEvidenceDirectory(project, ticket);
  const judged = judgeEvidence(parsed, { investigation, existingFiles: await filesIn(folder), accepted });
  return { ...judged, screenshots: judged.screenshots.map((shot) => ({ ...shot, path: join(folder, shot.file) })) };
}

/** `status` "Done" judges an accepted ticket's record by the rules it was accepted under (no coverage map before TR-079). */
export function ticketEvidence(project: string, ticket: string, notes: string | null, labels: readonly string[], status: string | null = null): Promise<EvidenceView> {
  return judgeTicketEvidence(project, ticket, parseEvidence(notes), labels.includes("investigation"), status === "Done");
}

/** Accept's guard: the error says what the owner still has to record. */
export async function requireCompleteEvidence(project: string, ticket: string, notes: string | null, labels: readonly string[]): Promise<void> {
  const evidence = await ticketEvidence(project, ticket, notes, labels);
  if (!evidence.complete) throw new Error(`${ticket} cannot be accepted yet: the evidence is missing ${evidence.missing.join("; ")}.`);
}
