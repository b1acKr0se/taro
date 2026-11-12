import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { serializeTicket, type Ticket } from "../shared/ticket-format";

const BIN = resolve(import.meta.dirname, "..", "bin", "taro");
const TIMEOUT = 30_000;
const at = (day: string, time: string): string => `2026-11-${day}T${time}Z`;

let home: string;

function ticket(id: string, notes: string): Ticket {
  return { id, title: `Ticket ${id}`, status: "Done", priority: null, labels: [], parent: null, dependsOn: [], created: at("01", "09:00:00"), updated: at("01", "09:00:00"), description: "", plan: "", criteria: [], notes, finalSummary: "", extra: {} };
}

function writeTicket(id: string, notes: string): void {
  writeFileSync(join(home, "plugin-data", "taro", "home", "projects", "app", "tracker", "tickets", `${id}.md`), serializeTicket(ticket(id, notes)));
}

function steps(day: string, planning: string, awaiting: string): { from: null; to: string; at: string }[] {
  return [
    { from: null, to: "Queued", at: at(day, "09:00") },
    { from: null, to: "Planning", at: at(day, planning) },
    { from: null, to: "Awaiting acceptance", at: at(day, awaiting) },
  ];
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "taro-stats-cli-"));
  mkdirSync(join(home, "plugin-data", "taro", "state"), { recursive: true });
  mkdirSync(join(home, "plugin-data", "taro", "home", "projects", "app", "tracker", "tickets"), { recursive: true });
  const tickets = {
    // Old record: no permission fields at all.
    "app:AP-1": { project: "app", ticket: "AP-1", title: "one", transitions: steps("02", "10:00", "11:00"), waiting: [{ start: at("02", "10:05"), end: at("02", "10:15") }], nudges: 1 },
    "app:AP-2": { project: "app", ticket: "AP-2", title: "two", transitions: steps("10", "10:00", "12:00"), waiting: [], permissionWaitMs: 300_000 },
    "app:AP-3": { project: "app", ticket: "AP-3", title: "three", transitions: [{ from: null, to: "Planning", at: at("11", "10:00") }], waiting: [] },
    "other:OT-1": { project: "other", ticket: "OT-1", title: "x", transitions: [], waiting: [] },
  };
  writeFileSync(join(home, "plugin-data", "taro", "state", "stats.json"), JSON.stringify({ tickets }));
  writeTicket("AP-1", `APPROVAL ${at("02", "10:10")} — the user: "Approve"\\n\\nANSWER ${at("02", "10:20")} — pick: "Q?" → A (the user, from the Taro screen)`.replace(/\\n/g, "\n"));
  writeTicket("AP-2", `NO-APPROVAL ${at("10", "10:30")} — 1 commit on b past main with the plan not approved this round: x`);
  writeTicket("AP-3", "");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function taro(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, PASEO_HOME: home };
  delete env.TARO_TRACKER;
  delete env.TARO_PROJECT;
  const result = spawnSync(BIN, args, { encoding: "utf8", env, timeout: 60_000 });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

describe("taro stats", () => {
  it("prints one ticket's round", { timeout: TIMEOUT }, () => {
    const result = taro(["stats", "AP-1", "--project", "app"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Planning → first Awaiting acceptance: 60 min");
    expect(result.stdout).toContain("In Needs you before approval: 5 min; after: 5 min");
    expect(result.stdout).toContain("Cards answered after approval: 1");
    expect(result.stdout).toContain("nudges 1");
    expect(result.stdout).toContain("Permission asks waited: 0 min");
  });

  it("prints a ticket still in Planning as not reached", { timeout: TIMEOUT }, () => {
    const result = taro(["stats", "AP-3", "--project", "app"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("not reached (Planning)");
    expect(result.stdout).toContain("not approved this round");
  });

  it("prints a project's median and p90, and --since leaves out the earlier tickets", { timeout: TIMEOUT }, () => {
    const all = taro(["stats", "--project", "app"]);
    expect(all.code).toBe(0);
    expect(all.stdout).toContain("3 tickets planned, 2 reached Awaiting acceptance");
    expect(all.stdout).toContain("Planning → first Awaiting acceptance: median 90 min, p90 120 min (2 tickets)");
    expect(all.stdout).toContain("Permission asks waited: median 2.5 min, p90 5 min (2 tickets)");
    const since = taro(["stats", "--project", "app", "--since", "2026-11-05"]);
    expect(since.stdout).toContain("planned since 2026-11-05: 2 tickets planned, 1 reached");
    expect(since.stdout).toContain("median 120 min, p90 120 min (1 tickets)");
    expect(since.stdout).toContain("Plugin corrections: median 1, p90 1 (1 tickets)");
  });

  it("prints JSON, and refuses a bad date, a missing ticket and no arguments", { timeout: TIMEOUT }, () => {
    const json = JSON.parse(taro(["stats", "AP-2", "--project", "app", "--json"]).stdout);
    expect(json).toMatchObject({ ticket: "AP-2", planningToAwaitingMs: 7_200_000, permissionWaitMs: 300_000, corrections: { noApproval: 1 } });
    expect(taro(["stats", "--project", "app", "--since", "soon"]).code).toBe(2);
    expect(taro(["stats", "AP-9", "--project", "app"]).stderr).toContain("No stats recorded for AP-9");
    expect(taro(["stats"]).code).toBe(2);
  });
});
