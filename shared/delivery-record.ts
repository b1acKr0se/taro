/**
 * What `taro deliver <ID>` writes, worked out from the ticket and the facts git and gh gave: the
 * EXECUTION record with the review head (and the pull request), FINAL's revision line, an EVIDENCE
 * record built from the check log when the owner confirms it, and the move to Awaiting acceptance.
 * Owners wrote these by hand and missed them; Accept then refused. It refuses with the list Accept
 * would give (the evidence check and `deliveryGaps`), and writes nothing then.
 * Pure: the `taro` command runs it under Node type stripping, so imports carry `.ts`.
 */
import { deliveryGaps, pullRequestUrl, reviewHead } from "./execution.ts";
import { judgeEvidence, parseEvidence, splitAtSeparator, type ParsedEvidence } from "./evidence.ts";
import { withNote } from "./ticket-format.ts";
import { isInvestigation } from "./ticket-level.ts";

/** What the delivered branch is: its head, its name, and its pull request (null for local delivery). */
export interface DeliveryFacts {
  head: string;
  branch: string;
  pullRequest: string | null;
}

export interface DeliveryTicket {
  id: string;
  status: string;
  labels: readonly string[];
  notes: string;
  finalSummary: string;
}

export interface DeliveryInput {
  ticket: DeliveryTicket;
  config: { delivery: string; acceptAlsoMerges: boolean };
  /** Null for an investigation, which delivers findings, not a branch. */
  facts: DeliveryFacts | null;
  /** What reading the branch found wrong (an unpushed head, uncommitted changes, no pull request). */
  problems: readonly string[];
  /** The check log's lines for the head, when the owner passed `--evidence-from-checks`; null otherwise. */
  checkLines: readonly string[] | null;
  /** The files in the ticket's evidence folder. */
  evidenceFiles: ReadonlySet<string>;
  at: string;
}

export interface DeliveryPlan {
  /** Why the ticket cannot be delivered; empty when it can. */
  missing: string[];
  appendNotes: string[];
  /** The FINAL summary with its revision line; null when it stays as it is. */
  finalSummary: string | null;
  /** Move to Awaiting acceptance (it is not there yet). */
  setStatus: boolean;
}

export { isInvestigation };

/** FINAL's last line, as `templates/final.md` has it. */
export function revisionLine(facts: DeliveryFacts): string {
  return `Revision: ${facts.head} on ${facts.branch} · PR: ${facts.pullRequest ?? "none (local-only)"}`;
}

const REVISION_LINE = /^[ \t]*\**Revision\**:.*$/m;

/** The summary with its revision line replaced, or added at the end when it has none. */
export function withRevisionLine(finalSummary: string, line: string): string {
  if (REVISION_LINE.test(finalSummary)) return finalSummary.replace(REVISION_LINE, line);
  return `${finalSummary.replace(/\s+$/, "")}\n\n${line}`;
}

/** The EXECUTION record the delivery adds. It names no owner, workspace or machine: those parsers read the newest record. */
export function deliveryExecutionRecord(at: string, facts: DeliveryFacts): string {
  return `EXECUTION ${at} — delivered with taro deliver: ${facts.pullRequest === null ? "" : `pr: ${facts.pullRequest}; `}review-head: ${facts.head}`;
}

/** Whether the round already records this head (and pull request): delivering again on it adds no record, which would read as presenting again. */
export function deliveryRecorded(notes: string, finalSummary: string, facts: DeliveryFacts): boolean {
  if (reviewHead(notes) !== facts.head) return false;
  return facts.pullRequest === null || pullRequestUrl(notes, finalSummary) === facts.pullRequest;
}

/** The non-check lines of an EVIDENCE record, as `parseEvidence` read them, written back. */
function carriedEvidenceLines(evidence: ParsedEvidence | null): string[] {
  if (evidence === null) return [];
  return [
    ...(evidence.review === null ? [] : [`review: ${evidence.review}`]),
    ...(evidence.ux === null ? [] : [`ux: ${evidence.ux}`]),
    ...evidence.coverage.map((entry) => `coverage: ${entry.section} — ${entry.files.join(", ") || "none"}`),
    ...evidence.screenshots.map((shot) => `screenshot: ${shot.file}${shot.caption === "" ? "" : ` — ${shot.caption}`}`),
    ...(evidence.screenshotsNone === null ? [] : [`screenshots: none${evidence.screenshotsNone === "" ? "" : ` — ${evidence.screenshotsNone}`}`]),
  ];
}

function commandOf(line: string): string {
  return splitAtSeparator(line.replace(/^check:\s*/i, ""))[0];
}

/**
 * A new EVIDENCE record: the logged checks, the owner's own `check:` lines for commands the log does
 * not have, and every other line of the newest record. Null when it would say what that record says.
 */
export function evidenceFromChecks(notes: string, at: string, checkLines: readonly string[]): string | null {
  const current = parseEvidence(notes);
  const logged = new Set(checkLines.map(commandOf));
  const ownChecks = (current?.checks ?? []).filter((check) => !logged.has(check.command)).map((check) => `check: ${check.command} — ${check.result}`);
  const checks = [...checkLines, ...ownChecks];
  const currentChecks = (current?.checks ?? []).map((check) => `check: ${check.command} — ${check.result}`);
  if (current !== null && checks.length === currentChecks.length && checks.every((line) => currentChecks.includes(line))) return null;
  const heading = `EVIDENCE ${at} — check lines from the check log (taro check)${current === null ? "" : "; the other lines carried from the record before"}`;
  return [heading, ...checks, ...carriedEvidenceLines(current)].join("\n");
}

/** Everything `taro deliver` would write, or why it may not. */
export function planDelivery(input: DeliveryInput): DeliveryPlan {
  const { ticket, facts } = input;
  const investigation = isInvestigation(ticket.labels);
  const appendNotes: string[] = [];
  if (facts !== null && !deliveryRecorded(ticket.notes, ticket.finalSummary, facts)) appendNotes.push(deliveryExecutionRecord(input.at, facts));
  if (input.checkLines !== null && input.checkLines.length > 0) {
    const evidence = evidenceFromChecks(ticket.notes, input.at, input.checkLines);
    if (evidence !== null) appendNotes.push(evidence);
  }
  // Judged as Accept will judge it: on the notes these records make.
  const notes = appendNotes.reduce(withNote, ticket.notes);
  const missing = [...input.problems];
  missing.push(...judgeEvidence(parseEvidence(notes), { investigation, existingFiles: input.evidenceFiles }).missing);
  missing.push(...deliveryGaps(input.config, investigation, notes, ticket.finalSummary));
  if (ticket.finalSummary.trim() === "") missing.push(`the FINAL summary: write it with taro ticket edit ${ticket.id} --final-summary (templates/final.md), then deliver again`);
  const finalSummary = facts === null || ticket.finalSummary.trim() === "" ? null : withRevisionLine(ticket.finalSummary, revisionLine(facts));
  return {
    missing,
    appendNotes,
    finalSummary: finalSummary === ticket.finalSummary ? null : finalSummary,
    setStatus: ticket.status !== "Awaiting acceptance",
  };
}
