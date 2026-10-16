/** The plan the user last answered, read from a real tracker's git history (TR-151). */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { serializeTicket, type Ticket } from "../shared/ticket-format";
import { planBeforeRecord, previousPlan } from "./plan-history";

const scratch = mkdtempSync(join(tmpdir(), "taro-plan-history-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

const PLAN_A = "## Goal\nNotes sort by edit date.\n\n## Choices I made\n- Newest first — most used on top\n\n## Size\nLow: self-review.";
const PLAN_B = `${PLAN_A.replace("## Size", "- Pinned notes first — asked for\n\n## Size")}`;
const ANSWER = 'ANSWER 2026-10-16T02:41:28.627Z — scope-approval: "Approve the plan for NA-12?" → Approve ("Approve") (the user, from the Taro screen)';
const CHANGES = 'ANSWER 2026-10-16T02:58:00.000Z — scope-approval: "Approve the plan for NA-12?" → Request changes ("pinned too") (the user, from the Taro screen)';

function ticket(plan: string, notes: string): string {
  const value: Ticket = {
    id: "NA-12",
    title: "Sort notes by edit date",
    status: "Planning",
    priority: null,
    labels: [],
    parent: null,
    dependsOn: [],
    created: "2026-10-16T02:30:00Z",
    updated: "2026-10-16T02:30:00Z",
    description: "## User's intent\n\nSort notes.",
    plan,
    criteria: [],
    notes,
    finalSummary: "",
    extra: {},
  };
  return serializeTicket(value);
}

function tracker(): { path: string; write: (plan: string, notes: string) => void; commit: () => void } {
  const path = mkdtempSync(join(scratch, "tracker-"));
  git(path, "init", "-q", "-b", "taro/tickets");
  mkdirSync(join(path, "tickets"));
  const write = (plan: string, notes: string) => writeFileSync(join(path, "tickets", "NA-12.md"), ticket(plan, notes));
  const commit = () => {
    git(path, "add", "-A");
    git(path, "-c", "user.name=Taro", "-c", "user.email=taro@localhost", "commit", "-q", "-m", "taro: update NA-12");
  };
  return { path, write, commit };
}

describe("previousPlan", () => {
  it("is the plan as it stood before the newest answer was committed, even with the new plan in that same commit", async () => {
    const repo = tracker();
    repo.write(PLAN_A, "MILESTONE 2026-10-16T02:35Z — plan written");
    repo.commit();
    repo.write(PLAN_A, `MILESTONE 2026-10-16T02:35Z — plan written\n\n${ANSWER}`);
    repo.commit();
    repo.write(PLAN_A, `MILESTONE 2026-10-16T02:35Z — plan written\n\n${ANSWER}\n\nMILESTONE 2026-10-16T02:42Z — building`);
    repo.commit();
    const notes = `MILESTONE 2026-10-16T02:35Z — plan written\n\n${ANSWER}\n\nMILESTONE 2026-10-16T02:42Z — building\n\n${CHANGES}`;
    // The owner rewrote the plan within the seconds before the debounced commit took both.
    repo.write(PLAN_B, notes);
    repo.commit();
    expect(await previousPlan(repo.path, "NA-12", notes)).toEqual({ plan: PLAN_A, at: "2026-10-16T02:58:00.000Z", kind: "changes requested" });
  });

  it("is null before any answer, and before the newest answer is committed, then found once it is", async () => {
    const repo = tracker();
    repo.write(PLAN_A, "MILESTONE 2026-10-16T02:35Z — plan written");
    repo.commit();
    expect(await previousPlan(repo.path, "NA-12", "MILESTONE 2026-10-16T02:35Z — plan written")).toBeNull();
    const notes = `MILESTONE 2026-10-16T02:35Z — plan written\n\n${ANSWER}`;
    repo.write(PLAN_A, notes);
    expect(await previousPlan(repo.path, "NA-12", notes)).toBeNull();
    repo.commit();
    expect(await previousPlan(repo.path, "NA-12", notes)).toEqual({ plan: PLAN_A, at: "2026-10-16T02:41:28.627Z", kind: "approved" });
  });

  it("is null when the ticket had no plan before the answer, or the tracker is not a git repository", async () => {
    const repo = tracker();
    repo.write("", "MILESTONE 2026-10-16T02:35Z — asked in words");
    repo.commit();
    repo.write(PLAN_A, `MILESTONE 2026-10-16T02:35Z — asked in words\n\n${ANSWER}`);
    repo.commit();
    expect(await planBeforeRecord(repo.path, "NA-12", ANSWER)).toBeNull();
    const plain = mkdtempSync(join(scratch, "plain-"));
    expect(await previousPlan(plain, "NA-12", ANSWER)).toBeNull();
  });

  it("is null when the answer came in the ticket's first commit", async () => {
    const repo = tracker();
    repo.write(PLAN_A, ANSWER);
    repo.commit();
    expect(await previousPlan(repo.path, "NA-12", ANSWER)).toBeNull();
  });
});
