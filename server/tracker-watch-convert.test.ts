/**
 * TR-081 review: the plugin starts on a tracker still in Backlog.md format (merge, reload, then
 * `taro convert`). Watching must leave it convertible, and the tickets written by the conversion
 * must be watched and committed afterwards. A real git tracker in a scratch directory.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backlogFormatAlert, alertHeading, BACKLOG_FORMAT_ALERT_ID } from "../shared/alerts";
import { convertTracker } from "./backlog-convert";
import { createTicketStore, isBacklogFormat } from "./ticket-store";
import { TrackerWatch } from "./tracker-watch";

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", ["-C", directory, "-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const previousHome = process.env.PASEO_HOME;
let root = "";
let tracker = "";
let watch = new TrackerWatch();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "taro-watch-convert-"));
  tracker = join(root, "tracker");
  mkdirSync(join(tracker, "backlog", "tasks"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", tracker]);
  writeFileSync(join(tracker, "backlog", "config.yml"), 'project_name: "notes-app"\nzero_padded_ids: 3\ntask_prefix: "NA"\n');
  writeFileSync(
    join(tracker, "backlog", "tasks", "na-001 - One.md"),
    ["---", "id: NA-001", "title: One", "status: In Progress", "assignee: []", "created_date: '2026-10-13 11:21'", "labels: []", "dependencies: []", "---", ""].join("\n"),
  );
  git(tracker, "add", "-A");
  git(tracker, "commit", "-q", "-m", "first");
  process.env.PASEO_HOME = join(root, "paseo");
  const home = join(root, "paseo", "plugin-data", "taro", "home", "projects", "demo");
  mkdirSync(home, { recursive: true });
  const config = { schemaVersion: 1, project: "demo", paseoProjectId: "p", repoPath: tracker, baseBranch: "main", ticketPrefix: "NA", manager: { model: "m" }, owner: { model: "m" }, trackerSync: "local" };
  writeFileSync(join(home, "taro.json"), JSON.stringify(config));
  execFileSync("ln", ["-s", tracker, join(home, "tracker")]);
  watch = new TrackerWatch(async () => null);
});

afterEach(() => {
  watch.stop();
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});

describe("watching a tracker still in Backlog.md format", () => {
  it("leaves it convertible, says so on the board, and watches the converted tickets", async () => {
    await watch.refresh();
    expect(existsSync(join(tracker, "tickets"))).toBe(false);
    expect(await isBacklogFormat(tracker)).toBe(true);
    const alert = backlogFormatAlert(tracker);
    expect(alert.id).toBe(BACKLOG_FORMAT_ALERT_ID);
    expect(alertHeading(alert.id)).toBe("Tracker not converted");
    expect(alert.text).toContain(`taro convert --dry-run, then taro convert, in ${tracker}`);

    await convertTracker(tracker);
    expect(await isBacklogFormat(tracker)).toBe(false);
    const converted = Number(git(tracker, "rev-list", "--count", "HEAD").trim());

    // tickets/ appeared after the watch began: an edit there is still committed by the watcher.
    await createTicketStore(tracker).appendNote("NA-001", "MILESTONE 2026-10-14 after the conversion");
    await vi.waitFor(() => expect(Number(git(tracker, "rev-list", "--count", "HEAD").trim())).toBe(converted + 1), { timeout: 15_000, interval: 250 });
    expect(git(tracker, "status", "--porcelain")).toBe("");
  }, 30_000);
});
