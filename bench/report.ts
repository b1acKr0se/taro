/**
 * `node bench/report.ts <result dir> <result dir> …`: the runs' `result.json` files as a Markdown table
 * per task, the first arm against the second (an arm is a plugin checkout at a commit). Runs under Node
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
  conformance: { kind: string; detail: string }[];
  records: { RISKS: number; RULING: number; EVIDENCE: number; FINAL: number };
  cardFailures: { kind: string; detail: string }[];
  /** What the run was allowed (absent in results from before the caps were recorded). */
  caps?: { maxMinutes: number; maxUsd: number };
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
    result.ownerPeakContextTokens === undefined || result.ownerPeakContextTokens === null ? "—" : tokens(result.ownerPeakContextTokens),
    modelsOf(result),
    capsOf(result),
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
  "Owner peak context",
  "Models",
  "Caps",
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
    const differing = [["models", modelsOf], ["caps", capsOf]].filter(([, read]) => new Set(ran.map(read as typeof modelsOf)).size > 1).map(([name]) => name);
    if (differing.length > 0) out.push(`> Warning: ${task}: the arms differ in ${differing.join(", ")}`, "");
  });
  return out.join("\n");
}

export function readResult(directory: string): ResultFile {
  return JSON.parse(readFileSync(join(directory, "result.json"), "utf8")) as ResultFile;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directories = process.argv.slice(2);
  if (directories.length === 0) {
    console.error("usage: node bench/report.ts <result dir> <result dir> …");
    process.exit(2);
  }
  console.log(renderReport(directories.map(readResult)));
}
