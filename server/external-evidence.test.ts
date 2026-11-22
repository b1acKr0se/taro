// Outside Paseo a session logs checks and delivers with only a tracker and a ticket: `taro check` needs no Paseo
// agent or label, and `taro deliver` skips the owner requirement on a ticket labelled external-host.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXTERNAL_HOST_LABEL } from "../shared/external-host";
import { createTicketStore } from "./ticket-store";

const BIN = resolve(import.meta.dirname, "..", "bin", "taro");
const TIMEOUT_MS = 60_000;
const EVIDENCE = "EVIDENCE 2026-11-22T11:00Z — verified\ncheck: npm test — 12 passed\nreview: none — worked alone outside Paseo\nscreenshots: none — no visible change";
const FINAL = "## What changed\n- Notes keep their order.\n\nRevision: <full SHA> on <branch> · PR: <URL>";

let scratch = "";
let repo = "";
let tracker = "";
let bin = "";

function git(...args: string[]): string {
  const result = spawnSync("git", ["-C", repo, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** The real `taro` command with no Paseo in its environment: no agent id, no project or tracker variables. */
function taro(args: string[], extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of ["PASEO_AGENT_ID", "PASEO_HOME", "PASEO_CLI", "TARO_TRACKER", "TARO_PROJECT", "TARO_EVIDENCE", "TARO_SKILL"]) delete env[key];
  const result = spawnSync(BIN, args, { cwd: repo, encoding: "utf8", env: { ...env, PATH: `${bin}:${process.env.PATH ?? ""}`, PASEO_HOME: join(scratch, "paseo"), ...extra }, timeout: TIMEOUT_MS });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

async function ticket(labels: string[], notes: string, finalSummary: string): Promise<void> {
  const store = createTicketStore(tracker, { prefix: "NO" });
  const created = await store.create({ title: "Keep note order", status: "In Progress", labels });
  await store.edit(created.id, { finalSummary, ...(notes === "" ? {} : { appendNotes: [notes] }) });
}

function readTicket(): string {
  return readFileSync(join(tracker, "tickets", "NO-001.md"), "utf8");
}

const checkLog = () => join(scratch, "paseo", "plugin-data", "taro", "state", "check-logs", "notes", "NO-001.jsonl");

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "taro-external-evidence-"));
  repo = join(scratch, "repo");
  tracker = join(scratch, "tracker");
  bin = join(scratch, "bin");
  mkdirSync(repo);
  mkdirSync(tracker);
  mkdirSync(bin);
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "notes.txt"), "one\n");
  git("add", "notes.txt");
  git("commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", "taro/no-001");
  writeFileSync(join(scratch, "taro.json"), JSON.stringify({ delivery: "local-only" }));
  // gh finds no pull request, for the pull-request delivery case.
  writeFileSync(join(bin, "gh"), "#!/bin/sh\necho 'no pull requests found for branch \"taro/no-001\"' >&2\nexit 1\n");
  chmodSync(join(bin, "gh"), 0o755);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("taro check outside Paseo", { timeout: TIMEOUT_MS }, () => {
  it("check without paseo", async () => {
    await ticket([], "", "");
    // The ticket from the branch name, the tracker and project from the shared lookup; no label needed.
    const result = taro(["check", "--tracker", tracker, "--project", "notes", "--", "true"]);
    expect(result.stderr).toContain("[taro] logged for NO-001");
    expect(result.code).toBe(0);
    const entries = readFileSync(checkLog(), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { command: string; exitCode: number; head: string });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ command: "true", exitCode: 0, head: git("rev-parse", "HEAD") });
  });

  it("check logs exit code and summary line", async () => {
    await ticket([], "", "");
    const result = taro(["check", "--tracker", tracker, "--project", "notes", "--ticket", "NO-001", "--", "sh -c 'echo 3 passed; echo 1 failed; exit 3'"]);
    expect(result.code).toBe(3);
    const [entry] = readFileSync(checkLog(), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { exitCode: number; summary: string });
    expect(entry?.exitCode).toBe(3);
    expect(entry?.summary).toBe("1 failed");
  });
});

describe("taro deliver outside Paseo", { timeout: TIMEOUT_MS }, () => {
  it("deliver without paseo", async () => {
    await ticket([EXTERNAL_HOST_LABEL], EVIDENCE, FINAL);
    const head = git("rev-parse", "HEAD");
    const result = taro(["deliver", "NO-001", "--tracker", tracker, "--project", "notes"], { TARO_EVIDENCE: join(scratch, "evidence") });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const text = readTicket();
    expect(text).toMatch(/status: "Awaiting acceptance"/);
    expect(text).toContain(`delivered with taro deliver: review-head: ${head}`);
    expect(text).toContain(`Revision: ${head} on taro/no-001 · PR: none (local-only)`);
  });

  it("deliver refuses without evidence", async () => {
    await ticket([EXTERNAL_HOST_LABEL], "", FINAL);
    const before = readTicket();
    const result = taro(["deliver", "NO-001", "--tracker", tracker, "--project", "notes"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("NO-001 is not delivered; nothing was written");
    expect(result.stderr).toMatch(/EVIDENCE/);
    expect(readTicket()).toBe(before);
  });

  it("deliver refuses without a FINAL or a pull request", async () => {
    await ticket([EXTERNAL_HOST_LABEL], EVIDENCE, "");
    const withoutFinal = taro(["deliver", "NO-001", "--tracker", tracker, "--project", "notes"]);
    expect(withoutFinal.code).toBe(1);
    expect(withoutFinal.stderr).toMatch(/final summary|FINAL/i);
    writeFileSync(join(scratch, "taro.json"), JSON.stringify({ delivery: "pull-request" }));
    const withoutPr = taro(["deliver", "NO-001", "--tracker", tracker, "--project", "notes"]);
    expect(withoutPr.code).toBe(1);
    expect(withoutPr.stderr).toContain("a pull request for taro/no-001");
  });

  it("unlabelled ticket refused", async () => {
    await ticket([], EVIDENCE, FINAL);
    const before = readTicket();
    const result = taro(["deliver", "NO-001", "--tracker", tracker, "--project", "notes"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("owner");
    expect(readTicket()).toBe(before);
  });
});
