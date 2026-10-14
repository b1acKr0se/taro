#!/usr/bin/env node
/**
 * Field-equality proof for `taro convert` (TR-081 spec S8):
 *
 *   node tools/compare-conversion.mjs <backlog folder>
 *
 * Copies the given `backlog/` folder into a fresh `mktemp -d` git repository (it never runs anything
 * in, or commits to, the folder it was given), asks Backlog for every task (`backlog task view <id>
 * --json`, with BACKLOG_CWD and TARO_TRACKER removed from the environment, from the scratch
 * repository), runs `bin/taro convert` there, then `bin/taro ticket view <id> --json`, and compares:
 * id, title, status, priority, labels, parentTaskId, dependencies, subtask ids, createdAt, updatedAt,
 * description, implementationPlan, implementationNotes, finalSummary, the acceptance criteria (index,
 * text, checked) and their counts (acceptanceCriteriaCount, acceptanceCriteriaCompleted). Prints each
 * mismatch and `N tickets, M values compared, K mismatches`, removes the scratch repository, and exits
 * 1 on any mismatch. Needs `backlog` and `git` on PATH.
 *
 * Normalisations (format, not content), applied to both sides:
 * - Sections: Backlog gives null for a missing section and Taro "": both read as "". Backlog's JSON
 *   trims whitespace around a section's text, while Taro keeps it (less the blank lines at either
 *   end), so both sides are compared trimmed.
 * - Dates: Backlog shows a date-only `created_date: 2026-10-12` as "2026-10-12"; Taro stores it as
 *   2026-10-12T00:00:00Z, so a date-only Backlog value is read as midnight UTC.
 * - updatedAt: Backlog gives null for a task without updated_date; Taro sets updated to created then.
 * - Subtasks: compared as sorted id lists (Backlog gives id and title, Taro full summaries).
 *
 * Backlog has no JSON view of archived tasks or drafts (`task view` cannot find them, `draft view`
 * has no --json): such tickets are listed as not compared; the converted ticket ids are still
 * checked against every task file's id.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { concurrencyLimit, runCommand } from "../server/process.ts";

const FOLDERS = ["tasks", "completed", "archive/tasks", "drafts"];
const TARO = resolve(import.meta.dirname, "..", "bin", "taro");

function cleanEnv() {
  const env = { ...process.env };
  delete env.BACKLOG_CWD;
  delete env.TARO_TRACKER;
  return env;
}

/** runCommand merges its env over process.env, so the variables are removed from this process for the run. */
delete process.env.BACKLOG_CWD;
delete process.env.TARO_TRACKER;

async function run(command, args, cwd) {
  const result = await runCommand(command, args, { cwd, env: cleanEnv(), timeoutMs: 120_000 });
  if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} failed (exit ${result.code}): ${(result.stderr || result.stdout).trim().split("\n")[0]}`);
  return result.stdout;
}

/** The id in a task file's frontmatter, quoted or not. */
function idOf(text) {
  const match = /^id:[ \t]*(['"]?)(.+?)\1[ \t]*\r?$/m.exec(text);
  return match === null ? null : match[2];
}

const section = (value) => (value ?? "").trim();
/** Backlog shows a date-only created_date as `2026-10-12`; Taro stores it as midnight UTC. */
const date = (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
const sortedIds = (list) => (list ?? []).map((entry) => entry.id).sort();

async function main() {
  const given = process.argv[2];
  if (given === undefined || !existsSync(join(given, "config.yml"))) {
    console.error("Usage: node tools/compare-conversion.mjs <backlog folder holding config.yml>");
    return 2;
  }
  const scratch = mkdtempSync(join(tmpdir(), "taro-compare."));
  console.log(`scratch repository: ${scratch}`);
  try {
    cpSync(resolve(given), join(scratch, "backlog"), { recursive: true });
    await run("git", ["init", "-q", "-b", "main"], scratch);
    await run("git", ["add", "backlog"], scratch);
    await run("git", ["-c", "user.name=Compare", "-c", "user.email=compare@example.com", "commit", "--no-verify", "-q", "-m", "backlog copy"], scratch);

    const ids = [];
    const folderOf = new Map();
    for (const folder of FOLDERS) {
      const directory = join(scratch, "backlog", folder);
      if (!existsSync(directory) || !statSync(directory).isDirectory()) continue;
      for (const name of readdirSync(directory).filter((entry) => entry.endsWith(".md")).sort()) {
        const id = idOf(readFileSync(join(directory, name), "utf8"));
        if (id === null) continue;
        ids.push(id);
        folderOf.set(id, folder);
      }
    }

    const limit = concurrencyLimit(4);
    // Backlog shows archived tasks and drafts in no JSON view: those are listed, not compared field by field.
    const shown = await Promise.all(
      ids.map((id) =>
        limit(async () => {
          const result = await runCommand("backlog", ["task", "view", id, "--json"], { cwd: scratch, env: cleanEnv(), timeoutMs: 120_000 });
          return { id, view: result.code === 0 ? JSON.parse(result.stdout).task : null, error: (result.stderr || result.stdout).trim().split("\n")[0] };
        }),
      ),
    );
    const notShown = shown.filter(({ view }) => view === null);
    const backlogViews = shown.filter(({ view }) => view !== null);

    const converted = await runCommand(TARO, ["convert", "--tracker", scratch], { cwd: scratch, env: cleanEnv(), timeoutMs: 120_000 });
    if (converted.code !== 0) {
      console.log(converted.stdout + converted.stderr);
      console.log(`taro convert failed (exit ${converted.code})`);
      return 1;
    }

    let values = 0;
    const mismatches = [];
    const compare = (id, field, backlogValue, taroValue) => {
      values++;
      if (JSON.stringify(backlogValue) !== JSON.stringify(taroValue)) {
        mismatches.push(`${id}.${field}: backlog=${JSON.stringify(backlogValue)?.slice(0, 200)} taro=${JSON.stringify(taroValue)?.slice(0, 200)}`);
      }
    };
    const taroViews = await Promise.all(
      backlogViews.map(({ id }) =>
        limit(async () => {
          const result = await runCommand(TARO, ["ticket", "view", id, "--json", "--tracker", scratch], { cwd: scratch, env: cleanEnv() });
          return result.code === 0 ? JSON.parse(result.stdout).ticket : { error: (result.stderr || result.stdout).trim() };
        }),
      ),
    );
    backlogViews.forEach(({ id, view: backlog }, position) => {
      const taro = taroViews[position];
      if (taro.error !== undefined) {
        values++;
        mismatches.push(`${id}: taro ticket view failed: ${taro.error}`);
        return;
      }
      compare(id, "id", backlog.id, taro.id);
      compare(id, "title", backlog.title, taro.title);
      compare(id, "status", backlog.status, taro.status);
      compare(id, "priority", backlog.priority ?? null, taro.priority);
      compare(id, "labels", backlog.labels ?? [], taro.labels);
      compare(id, "parentTaskId", backlog.parentTaskId ?? null, taro.parent);
      compare(id, "dependencies", backlog.dependencies ?? [], taro.dependsOn);
      compare(id, "subtasks", sortedIds(backlog.subtasks), sortedIds(taro.subtasks));
      compare(id, "createdAt", date(backlog.createdAt), taro.created);
      compare(id, "updatedAt", date(backlog.updatedAt ?? backlog.createdAt), taro.updated);
      compare(id, "description", section(backlog.description), section(taro.description));
      compare(id, "implementationPlan", section(backlog.implementationPlan), section(taro.plan));
      compare(id, "implementationNotes", section(backlog.implementationNotes), section(taro.notes));
      compare(id, "finalSummary", section(backlog.finalSummary), section(taro.finalSummary));
      const backlogCriteria = backlog.acceptanceCriteria ?? [];
      compare(id, "acceptanceCriteriaCount", backlog.acceptanceCriteriaCount ?? backlogCriteria.length, taro.criteria.length);
      compare(
        id,
        "acceptanceCriteriaCompleted",
        backlog.acceptanceCriteriaCompleted ?? backlogCriteria.filter((criterion) => criterion.checked).length,
        taro.criteria.filter((criterion) => criterion.checked).length,
      );
      const count = Math.max(backlogCriteria.length, taro.criteria.length);
      for (let index = 0; index < count; index++) {
        const left = backlogCriteria[index] ?? {};
        const right = taro.criteria[index] ?? {};
        compare(id, `acceptanceCriteria[${index}].index`, left.index, right.index);
        compare(id, `acceptanceCriteria[${index}].text`, left.text, right.text);
        compare(id, `acceptanceCriteria[${index}].checked`, left.checked, right.checked);
      }
    });

    // Every converted ticket must be one Backlog showed: nothing added, nothing lost.
    const listed = JSON.parse(await run(TARO, ["ticket", "list", "--json", "--tracker", scratch], scratch)).tickets.map((ticket) => ticket.id).sort();
    compare("tracker", "ticket ids", [...ids].sort(), listed);

    for (const { id, error } of notShown) console.log(`${id} (backlog/${folderOf.get(id)}): not compared, Backlog shows no JSON view of it: ${error}`);
    for (const mismatch of mismatches) console.log(mismatch);
    console.log(`${backlogViews.length} tickets, ${values} values compared, ${mismatches.length} mismatches`);
    return mismatches.length === 0 ? 0 : 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

process.exitCode = await main();
