/**
 * TR-051: the tracker guard against a real git repository (a scratch one, never
 * the live tracker), with Backlog's own `backlog init` when it is installed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backlogBinary, commitTracker, TRACKER_BRANCH } from "./tracker";
import { TrackerWatch } from "./tracker-watch";
import { PluginState } from "./state";

const CONFIG = 'project_name: "demo"\ndefault_status: "Backlog"\nstatuses: ["Backlog","Done"]\nzero_padded_ids: 3\ntask_prefix: "DM"\nauto_commit: false\n';
const RULES = "# Repository rules\n";
const TICKET = "backlog/tasks/dm-001 - First.md";
const GUIDELINES = "\n<!-- BACKLOG.MD GUIDELINES START -->\nUse the CLI.\n<!-- BACKLOG.MD GUIDELINES END -->\n";

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, "-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

let root = "";
let tracker = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "taro-guard-"));
  tracker = join(root, "tracker");
  mkdirSync(join(tracker, "backlog", "tasks"), { recursive: true });
  git(tracker, "init", "-q", "-b", TRACKER_BRANCH);
  writeFileSync(join(tracker, "backlog", "config.yml"), CONFIG);
  writeFileSync(join(tracker, TICKET), "status: Backlog\n");
  writeFileSync(join(tracker, "AGENTS.md"), RULES);
  git(tracker, "add", "-A");
  git(tracker, "commit", "-q", "-m", "onboarded");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function committed(file: string): string {
  return git(tracker, "show", `HEAD:${file}`);
}

function working(file: string): string {
  return readFileSync(join(tracker, file), "utf8");
}

describe("commitTracker's guard", () => {
  it("restores a renamed project and Backlog's AGENTS.md block, and still commits the ticket edited alongside", async () => {
    writeFileSync(join(tracker, "backlog", "config.yml"), CONFIG.replace('"demo"', '"scratch"'));
    writeFileSync(join(tracker, "AGENTS.md"), RULES + GUIDELINES);
    writeFileSync(join(tracker, TICKET), "status: Planning\n");

    const result = await commitTracker(tracker);

    expect(result.subject).toBe("taro: update DM-001");
    expect(result.restored).toEqual(['backlog/config.yml (project_name "demo" → "scratch")', "AGENTS.md (Backlog's guidelines taken out)"]);
    expect(committed("backlog/config.yml")).toBe(CONFIG);
    expect(working("backlog/config.yml")).toBe(CONFIG);
    expect(working("AGENTS.md")).toBe(RULES);
    expect(committed(TICKET)).toBe("status: Planning\n");
    expect(git(tracker, "status", "--porcelain")).toBe("");
  });

  it("removes an instruction file Backlog created that was never committed", async () => {
    writeFileSync(join(tracker, "CLAUDE.md"), GUIDELINES);
    const result = await commitTracker(tracker);
    expect(result).toEqual({ subject: null, restored: ["CLAUDE.md (removed: Backlog wrote it)"] });
    expect(existsSync(join(tracker, "CLAUDE.md"))).toBe(false);
  });

  it("commits ordinary config and instruction-file edits untouched", async () => {
    const statuses = CONFIG.replace('["Backlog","Done"]', '["Backlog","Planning","Done"]');
    writeFileSync(join(tracker, "backlog", "config.yml"), statuses);
    writeFileSync(join(tracker, "AGENTS.md"), `${RULES}One more rule.\n`);
    const result = await commitTracker(tracker);
    expect(result).toEqual({ subject: "taro: update tracker", restored: [] });
    expect(committed("backlog/config.yml")).toBe(statuses);
    expect(working("AGENTS.md")).toBe(`${RULES}One more rule.\n`);
  });

  it("leaves a tracker without a committed config alone, as onboarding writes it", async () => {
    git(tracker, "rm", "-q", "--cached", "backlog/config.yml");
    git(tracker, "commit", "-q", "-m", "no config yet");
    writeFileSync(join(tracker, "backlog", "config.yml"), CONFIG.replace('"demo"', '"other"'));
    const result = await commitTracker(tracker);
    expect(result.restored).toEqual([]);
    expect(committed("backlog/config.yml")).toBe(CONFIG.replace('"demo"', '"other"'));
  });

  it("undoes Backlog's real `backlog init` run against the tracker", async (context) => {
    const backlog = await backlogBinary();
    if (backlog === null) {
      context.skip();
      return;
    }
    const environment = { ...process.env };
    delete environment.BACKLOG_CWD;
    delete environment.TARO_TRACKER;
    execFileSync(backlog, ["init", "scratch", "--defaults"], { cwd: tracker, env: environment, stdio: "ignore" });
    expect(working("backlog/config.yml")).toContain('project_name: "scratch"');
    expect(working("AGENTS.md")).not.toBe(RULES);

    const result = await commitTracker(tracker);

    expect(result.restored.join("\n")).toContain('project_name "demo" → "scratch"');
    expect(working("backlog/config.yml")).toBe(CONFIG);
    expect(working("AGENTS.md")).toBe(RULES);
    expect(committed("backlog/config.yml")).toBe(CONFIG);
    expect(git(tracker, "log", "--oneline").trim().split("\n")).toHaveLength(1);
  });
});

describe("TrackerWatch and the kept refusal", () => {
  const previousHome = process.env.PASEO_HOME;

  beforeEach(() => {
    process.env.PASEO_HOME = join(root, "paseo");
    const home = join(root, "paseo", "plugin-data", "taro", "home", "projects", "demo");
    mkdirSync(home, { recursive: true });
    const config = {
      schemaVersion: 1,
      project: "demo",
      paseoProjectId: "p",
      repoPath: tracker,
      baseBranch: "main",
      ticketPrefix: "DM",
      manager: { model: "m" },
      owner: { model: "m" },
      trackerSync: "local",
    };
    writeFileSync(join(home, "taro.json"), JSON.stringify(config));
    execFileSync("ln", ["-s", tracker, join(home, "tracker")]);
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
  });

  it("hands what it restored to the handler before the change listeners, and a new state reads it back until dismissed", async () => {
    const state = new PluginState();
    const order: string[] = [];
    const watch = new TrackerWatch();
    watch.onRestored(async (project, restored) => {
      order.push("restored");
      await state.recordTrackerProtection(project, restored, "2026-10-14T08:00:00.000Z");
    });
    watch.onChange(() => order.push("changed"));
    writeFileSync(join(tracker, "backlog", "config.yml"), CONFIG.replace('"DM"', '"task"'));

    await watch.commit("demo");
    watch.stop();

    expect(order).toEqual(["restored", "changed"]);
    const reloaded = new PluginState();
    expect(await reloaded.trackerProtection("demo")).toEqual({ at: "2026-10-14T08:00:00.000Z", restored: ['backlog/config.yml (task_prefix "DM" → "task")'] });
    await reloaded.dismissTrackerProtection("demo");
    expect(await new PluginState().trackerProtection("demo")).toBeNull();
  });

  it("does not call the handler when nothing was restored", async () => {
    const watch = new TrackerWatch();
    let calls = 0;
    watch.onRestored(async () => {
      calls += 1;
    });
    writeFileSync(join(tracker, TICKET), "status: Planning\n");
    await watch.commit("demo");
    expect(calls).toBe(0);
    expect(committed(TICKET)).toBe("status: Planning\n");
  });
});
