/**
 * Checks a task against its own reference: the reference (a folder copied over `repo/`, or a patch
 * applied to it) must pass every hidden test, and the unfixed `repo/` must fail the tests the task
 * says (`unfixedFails` in task.json: tests whose id contains `match`, exactly `count` of them, all
 * others passing), or every test when it says nothing. Usage: `node bench/selfcheck.ts <task>`.
 * The run follows superlite's bench/harness.py `hidden_score` (MIT, THIRD_PARTY_NOTICES.md).
 * Runs under Node type stripping.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "./process.ts";
import { SCRATCH_PREFIX, assertSafeHome } from "./safety.ts";
import { hiddenRequirements, parseTestOutput, runTestCommand, type HiddenScore } from "./score.ts";

interface TaskSettings {
  hiddenInto?: string;
  reference?: string;
  unfixedFails?: { match: string; count: number };
}

export interface SelfcheckRun {
  score: HiddenScore | null;
  failing: string[];
}

/** The ids of the tests a verbose pytest run reports failed or errored. */
export function failingTests(output: string): string[] {
  return output.split("\n").flatMap((line) => {
    const match = /^(\S+::\S+)\s+(?:FAILED|ERROR)\b/.exec(line);
    return match === null ? [] : [match[1] as string];
  });
}

/** What is wrong with the two runs, as sentences; empty when the task checks out. */
export function selfcheckProblems(settings: TaskSettings, reference: SelfcheckRun, unfixed: SelfcheckRun): string[] {
  const problems: string[] = [];
  if (reference.score === null) problems.push("the reference run printed no score");
  else if (reference.score.passed !== reference.score.total) problems.push(`the reference passes ${reference.score.passed} of ${reference.score.total}`);
  if (unfixed.score === null) {
    problems.push("the unfixed run printed no score");
    return problems;
  }
  const expected = settings.unfixedFails;
  if (expected === undefined) {
    if (unfixed.score.passed !== 0) problems.push(`the unfixed repo passes ${unfixed.score.passed} of ${unfixed.score.total}; none should pass`);
    return problems;
  }
  const matching = unfixed.failing.filter((id) => id.includes(expected.match));
  const others = unfixed.failing.length - matching.length;
  if (matching.length !== expected.count) problems.push(`${matching.length} tests matching "${expected.match}" fail unfixed; expected ${expected.count}`);
  if (others !== 0) problems.push(`${others} other tests fail unfixed; expected none`);
  return problems;
}

async function scoreCopy(taskDirectory: string, settings: TaskSettings, reference: boolean): Promise<SelfcheckRun & { output: string }> {
  const copy = mkdtempSync(join(tmpdir(), `${SCRATCH_PREFIX}selfcheck.`));
  assertSafeHome(copy);
  try {
    cpSync(join(taskDirectory, "repo"), copy, { recursive: true });
    if (reference) {
      const source = join(taskDirectory, settings.reference ?? "reference");
      if (statSync(source).isDirectory()) cpSync(source, copy, { recursive: true });
      else {
        const applied = await run("git", ["apply", source], { cwd: copy });
        if (applied.code !== 0) return { score: null, failing: [], output: `git apply failed: ${applied.stderr}` };
      }
    }
    cpSync(join(taskDirectory, "hidden"), join(copy, settings.hiddenInto ?? "hidden"), { recursive: true });
    const { output } = await runTestCommand(readFileSync(join(taskDirectory, "test-command"), "utf8").trim(), copy, undefined, hiddenRequirements(taskDirectory));
    return { score: parseTestOutput(output), failing: failingTests(output), output };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

async function main(name: string | undefined): Promise<number> {
  const taskDirectory = name === undefined ? "" : resolve(dirname(fileURLToPath(import.meta.url)), "tasks", name);
  if (name === undefined || !/^[a-z0-9-]+$/.test(name) || !existsSync(join(taskDirectory, "task.json"))) {
    console.error("usage: node bench/selfcheck.ts <task>");
    return 2;
  }
  const settings = JSON.parse(readFileSync(join(taskDirectory, "task.json"), "utf8")) as TaskSettings;
  const reference = await scoreCopy(taskDirectory, settings, true);
  const unfixed = await scoreCopy(taskDirectory, settings, false);
  const show = (run: SelfcheckRun): string => (run.score === null ? "no score" : `${run.score.passed} of ${run.score.total} pass`);
  console.log(`${name}: reference applied: ${show(reference)}`);
  console.log(`${name}: unfixed repo: ${show(unfixed)}${unfixed.failing.length === 0 ? "" : `; ${unfixed.failing.length} failing`}`);
  const problems = selfcheckProblems(settings, reference, unfixed);
  problems.forEach((problem) => console.log(`PROBLEM: ${problem}`));
  if (problems.length > 0) console.log(`reference output tail:\n${reference.output.slice(-1500)}\nunfixed output tail:\n${unfixed.output.slice(-1500)}`);
  console.log(problems.length === 0 ? `${name}: ok` : `${name}: FAILED`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv[2]);
