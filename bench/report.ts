/**
 * `node bench/report.ts <result dir> …`: the runs' `result.json` files grouped by task and arm, the spread
 * (min / median / max) over the runs as a Markdown table per task; `--pairs` instead gives one run per arm, the first arm against the second (an arm is a plugin checkout at a commit). Runs under Node
 * type stripping: erasable syntax, `.ts` import extensions, no packages.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface ResultFile {
  task: string;
  arm: { checkout: string; sha: string };
  models: { owner: string; subagents: string[] };
  stop: "done" | "time" | "cost" | "error";
  wallMs: number;
  costUsd: number;
  byRole: Record<string, { agents: number; models: string[]; costUsd: number; peakContextTokens: number; turns: number; activeMs: number }>;
  hidden: { passed: number; total: number } | null;
  questions: { asked: number; preferenceHits: number; redundant: number };
  /** Cards other than the plan and Accept answered after the first Approve; absent in results from before it was recorded. */
  cardsAfterApproval?: number;
  /** The user's time the cards would take, at the run's minutes per card. */
  userMinutesModelled?: number;
  wallMinutes?: number;
  /** `wallMinutes` plus `userMinutesModelled`. */
  wallMinutesWithUser?: number;
  /** Hidden preferences the decider's answers touched, by the side of the approval of the first answer. */
  preferences?: { beforeApproval: number; afterApproval: number };
  conformance: { kind: string; detail: string }[];
  records: { RISKS: number; RULING: number; EVIDENCE: number; FINAL: number };
  cardFailures: { kind: string; detail: string }[];
  /** What the run was allowed (absent in results from before the caps were recorded). */
  caps?: { maxMinutes: number; maxUsd: number };
  /** How the decider answered: over RPC (default) or through the web UI (absent in results from before this was recorded, which were all UI). */
  decider?: "rpc" | "ui";
  /** Planted defects the merged main fixed, for a task that plants some; the report does not print it. */
  planted?: { caught: number; total: number } | null;
  /** The owner's largest request, from its Claude transcript; null when the transcript was not found. */
  ownerPeakContextTokens?: number | null;
}

const OWNER_ROLE = "owner";

/** An arm is a commit of the plugin: two copies of the same commit are one arm. */
export function armKey(result: ResultFile): string {
  return result.arm.sha;
}

const usd = (value: number): string => `$${value.toFixed(2)}`;
const tokens = (value: number): string => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(value));
function minutes(milliseconds: number): string {
  const total = Math.round(milliseconds / 60000);
  return total >= 60 ? `${Math.floor(total / 60)}h ${total % 60}m` : `${total}m`;
}

function byKind(violations: { kind: string }[]): string {
  if (violations.length === 0) return "none";
  const counts = new Map<string, number>();
  violations.forEach(({ kind }) => counts.set(kind, (counts.get(kind) ?? 0) + 1));
  return [...counts.entries()].map(([kind, count]) => `${kind} ×${count}`).join(", ");
}

function stopNote(result: ResultFile): string {
  return result.stop === "done" ? "" : ` (stopped: ${result.stop === "cost" ? "cost cap" : result.stop === "time" ? "time cap" : "error"})`;
}

const modelsOf = (result: ResultFile): string => `owner ${result.models.owner}; subagents ${result.models.subagents.join(", ") || "none"}`;
const capsOf = (result: ResultFile): string => (result.caps === undefined ? "unknown" : `${result.caps.maxMinutes} min, ${usd(result.caps.maxUsd)}`);

/** The rows of one task's table for one arm; the same labels in the same order for every arm. */
function column(result: ResultFile | undefined): string[] {
  if (result === undefined) return Array.from({ length: ROWS.length }, () => "—");
  const owner = result.byRole[OWNER_ROLE];
  const ownerCost = owner?.costUsd ?? 0;
  const note = stopNote(result);
  return [
    `${usd(result.costUsd)}${note}`,
    usd(ownerCost),
    usd(result.costUsd - ownerCost),
    owner === undefined ? "—" : tokens(owner.peakContextTokens),
    result.ownerPeakContextTokens === undefined || result.ownerPeakContextTokens === null ? "—" : tokens(result.ownerPeakContextTokens),
    modelsOf(result),
    capsOf(result),
    result.decider ?? "ui",
    minutes(result.wallMs),
    result.hidden === null ? "not run" : `${result.hidden.passed}/${result.hidden.total}`,
    `${result.questions.asked} (${result.questions.preferenceHits} / ${result.questions.redundant})`,
    byKind(result.conformance),
    byKind(result.cardFailures),
  ];
}

const ROWS = [
  "Cost, total",
  "Cost, owner",
  "Cost, subagents",
  "Owner context at end",
  "Owner peak context",
  "Models",
  "Caps",
  "Decider",
  "Wall time",
  "Hidden tests passed",
  "Questions (preference hits / redundant)",
  "Conformance violations",
  "Card failures",
];

/** One Markdown table per task, arms in the order they first appear; a task with a missing arm shows dashes. */
export function renderReport(results: readonly ResultFile[]): string {
  const arms: string[] = [];
  results.forEach((result) => {
    if (!arms.includes(armKey(result))) arms.push(armKey(result));
  });
  const names = arms.map((key) => `${String.fromCharCode(65 + arms.indexOf(key))} · ${key.slice(0, 7)}`);
  const tasks: string[] = [];
  results.forEach((result) => {
    if (!tasks.includes(result.task)) tasks.push(result.task);
  });
  const out: string[] = [];
  tasks.forEach((task) => {
    const columns = arms.map((key) => column(results.find((result) => result.task === task && armKey(result) === key)));
    out.push(`### ${task}`, "", `| | ${names.join(" | ")} |`, `| --- | ${names.map(() => "---").join(" | ")} |`);
    ROWS.forEach((row, index) => out.push(`| ${row} | ${columns.map((rows) => rows[index]).join(" | ")} |`));
    out.push("");
    // Arms that ran on different models or caps are not a like-for-like comparison.
    const ran = arms.flatMap((key) => results.filter((result) => result.task === task && armKey(result) === key).slice(0, 1));
    // Unknown caps (a result from before they were recorded) are left out of the comparison.
    const differing = [["models", ran.map(modelsOf)], ["caps", ran.filter((result) => result.caps !== undefined).map(capsOf)]].filter(([, values]) => new Set(values).size > 1).map(([name]) => name);
    if (differing.length > 0) out.push(`> Warning: ${task}: the arms differ in ${differing.join(", ")}`, "");
  });
  return out.join("\n");
}

const MINIMUM_FINISHED_RUNS = 3;

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** "min / median / max" of the values, or "n/a" when there are none. */
function spread(values: readonly number[], format: (value: number) => string): string {
  if (values.length === 0) return "n/a";
  const sorted = [...values].sort((first, second) => first - second);
  return [sorted[0]!, median(sorted), sorted[sorted.length - 1]!].map(format).join(" / ");
}

/**
 * Per task, per arm: the spread over the finished runs (a run stopped by a cap or an error is not
 * finished: its hidden tests were not scored). Cost per hidden test is taken run by run, and a run that
 * passed none has no such cost, so it is left out instead of dividing by zero.
 */
export function renderSpread(results: readonly ResultFile[]): string {
  const arms = [...new Set(results.map(armKey))];
  const tasks = [...new Set(results.map((result) => result.task))];
  const out: string[] = [];
  const short: string[] = [];
  tasks.forEach((task) => {
    const names = arms.map((key) => `${String.fromCharCode(65 + arms.indexOf(key))} · ${key.slice(0, 7)}`);
    const groups = arms.map((key) => results.filter((result) => result.task === task && armKey(result) === key));
    const finished = groups.map((group) => group.filter((result) => result.stop === "done"));
    const scored = finished.map((group) => group.filter((result) => result.hidden !== null));
    const planted = finished.map((group) => group.flatMap((result) => (result.planted === undefined || result.planted === null ? [] : [result.planted])));
    const rows: [string, string[]][] = [
      ["Runs", groups.map((group, index) => (group.length === finished[index]!.length ? String(group.length) : `${group.length} (${finished[index]!.length} finished)`))],
      ["Cost", finished.map((group) => spread(group.map((result) => result.costUsd), usd))],
      ["Wall minutes", finished.map((group) => spread(group.map((result) => result.wallMs / 60000), (value) => String(Math.round(value))))],
      ["Wall minutes with the user's time", finished.map((group) => spread(group.flatMap((result) => result.wallMinutesWithUser ?? []), (value) => String(Math.round(value))))],
      ["Cards after approval", finished.map((group) => spread(group.flatMap((result) => result.cardsAfterApproval ?? []), String))],
      ["User minutes modelled", finished.map((group) => spread(group.flatMap((result) => result.userMinutesModelled ?? []), (value) => String(Math.round(value))))],
      ["Preferences before approval", finished.map((group) => spread(group.flatMap((result) => result.preferences?.beforeApproval ?? []), String))],
      ["Preferences after approval", finished.map((group) => spread(group.flatMap((result) => result.preferences?.afterApproval ?? []), String))],
      ["Hidden passed", scored.map((group) => spread(group.map((result) => result.hidden?.passed ?? 0), String))],
      ["Owner peak context", finished.map((group) => spread(group.flatMap((result) => result.ownerPeakContextTokens ?? []), tokens))],
      ["Cost per hidden test passed", scored.map((group) => spread(group.flatMap((result) => (result.hidden !== null && result.hidden.passed > 0 ? [result.costUsd / result.hidden.passed] : [])), usd))],
    ];
    const total = planted.flat()[0]?.total;
    if (total !== undefined) rows.push([`Planted caught (of ${total})`, planted.map((group) => spread(group.map((entry) => entry.caught), String))]);
    out.push(`### ${task}`, "", `| | ${names.join(" | ")} |`, `| --- | ${names.map(() => "---").join(" | ")} |`);
    rows.forEach(([label, cells]) => out.push(`| ${label} | ${cells.join(" | ")} |`));
    out.push("");
    arms.forEach((key, index) => {
      const count = finished[index]!.length;
      if (count < MINIMUM_FINISHED_RUNS) short.push(`${task} ${names[index]} (${count})`);
    });
  });
  if (short.length > 0) out.push(`> Fewer than ${MINIMUM_FINISHED_RUNS} finished runs: ${short.join("; ")}`, "");
  return out.join("\n");
}

export function readResult(directory: string): ResultFile {
  return JSON.parse(readFileSync(join(directory, "result.json"), "utf8")) as ResultFile;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pairs = process.argv.includes("--pairs");
  const directories = process.argv.slice(2).filter((argument) => argument !== "--pairs");
  if (directories.length === 0) {
    console.error("usage: node bench/report.ts [--pairs] <result dir> <result dir> …");
    process.exit(2);
  }
  const results = directories.map(readResult);
  console.log(pairs ? renderReport(results) : renderSpread(results));
}
