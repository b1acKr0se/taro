/**
 * The plan the user last answered (TR-151), read from the tracker's history: the ticket file as it
 * stood in the parent of the commit that added the newest plan answer. The parent, not that commit,
 * because the owner may rewrite the plan within the few seconds before the debounced commit; the
 * plan itself was written before it was asked, so it is committed by then.
 */
import { join } from "node:path";

import type { TicketDetailView } from "../shared/contracts";
import { lastPlanAnswer, planAnswerRecords } from "../shared/plan-changes";
import { parseTicket } from "../shared/ticket-format";
import { runCommand } from "./process";

/** Found plans by tracker, ticket and record line; a record not committed yet is looked up again. */
const found = new Map<string, string | null>();
const FOUND_KEPT = 200;

async function git(trackerPath: string, args: readonly string[]): Promise<string | null> {
  const result = await runCommand("git", ["-C", trackerPath, ...args], { timeoutMs: 30_000 });
  return result.code === 0 ? result.stdout : null;
}

/** The ticket's plan just before `recordLine` was committed; null when that commit is not found (yet) or the plan was empty. */
export async function planBeforeRecord(trackerPath: string, ticketId: string, recordLine: string): Promise<string | null> {
  const key = [trackerPath, ticketId, recordLine].join("\n");
  if (found.has(key)) return found.get(key) ?? null;
  const file = `tickets/${ticketId}.md`;
  // Pickaxe: the commits that changed how often the line occurs; the oldest added it.
  const commits = (await git(trackerPath, ["log", "--format=%H", `-S${recordLine}`, "--", file]))?.split("\n").filter((line) => line !== "") ?? [];
  const adding = commits[commits.length - 1];
  if (adding === undefined) return null;
  const text = await git(trackerPath, ["show", `${adding}^:${file}`]);
  const parsed = text === null ? null : parseTicket(text, join(trackerPath, file));
  const plan = parsed !== null && parsed.ok && parsed.ticket.plan.trim() !== "" ? parsed.ticket.plan : null;
  found.set(key, plan);
  if (found.size > FOUND_KEPT) found.delete(found.keys().next().value ?? "");
  return plan;
}

/**
 * How long after a plan was asked its ticket's commit may land: the tracker commits 5 s after a
 * write (`tracker-watch.ts`). Kept short, so a plan rewritten soon after it was asked (withdrawn and
 * asked again) is not taken for it.
 */
const ASKED_GRACE_MS = 15_000;

/** The ticket's plan as committed by `askedAt` (and the grace after it); null when no commit is that old or the plan was empty. */
async function planAsAsked(trackerPath: string, ticketId: string, askedAt: string): Promise<string | null> {
  const asked = Date.parse(askedAt);
  if (Number.isNaN(asked)) return null;
  const file = `tickets/${ticketId}.md`;
  const before = new Date(asked + ASKED_GRACE_MS).toISOString();
  const commit = (await git(trackerPath, ["log", "-1", "--format=%H", `--before=${before}`, "--", file]))?.trim() ?? "";
  if (commit === "") return null;
  const text = await git(trackerPath, ["show", `${commit}:${file}`]);
  const parsed = text === null ? null : parseTicket(text, join(trackerPath, file));
  return parsed !== null && parsed.ok && parsed.ticket.plan.trim() !== "" ? parsed.ticket.plan : null;
}

/**
 * A finished plan card's plan (TR-157): the plan just before the answer recorded at `answeredAt`,
 * or, for a plan never answered on its card (withdrawn, answered in the chat), the plan as committed
 * when it was asked at `askedAt`. Null when the tracker's history does not reach it.
 */
export async function pastPlan(trackerPath: string, ticketId: string, notes: string | null, card: { answeredAt: string | null; askedAt: string | null }): Promise<string | null> {
  const record = card.answeredAt === null ? undefined : planAnswerRecords(notes).find((each) => each.at === card.answeredAt);
  if (record !== undefined) {
    const plan = await planBeforeRecord(trackerPath, ticketId, record.line).catch(() => null);
    if (plan !== null) return plan;
  }
  return card.askedAt === null ? null : planAsAsked(trackerPath, ticketId, card.askedAt).catch(() => null);
}

/** The plan the user last answered, with when and how, for the ticket's detail; null before any answer or when not found. */
export async function previousPlan(trackerPath: string, ticketId: string, notes: string | null): Promise<TicketDetailView["previousPlan"]> {
  const record = lastPlanAnswer(notes);
  if (record === null) return null;
  const plan = await planBeforeRecord(trackerPath, ticketId, record.line).catch(() => null);
  return plan === null ? null : { plan, at: record.at, kind: record.kind };
}
