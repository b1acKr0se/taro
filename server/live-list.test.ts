import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { liveListEntry, liveListPath, recordLiveList } from "./live-list";

let home: string;
const previousHome = process.env.PASEO_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "taro-live-list-"));
  process.env.PASEO_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

const entry = (project: string, writtenAt: string, cardKeys: string[] = []) => liveListEntry(project, [], {}, cardKeys, writtenAt);

describe("recordLiveList", () => {
  it("keeps the other projects' entries when one is written", async () => {
    await recordLiveList(entry("notes-app", "2026-10-13T15:00:00.000Z", ["a:one"]));
    await recordLiveList(entry("other-app", "2026-10-13T15:00:01.000Z"));
    await recordLiveList(entry("notes-app", "2026-10-13T15:00:02.000Z", ["a:two"]));
    const projects = JSON.parse(readFileSync(liveListPath(), "utf8")).projects;
    expect(Object.keys(projects).sort()).toEqual(["notes-app", "other-app"]);
    expect(projects["notes-app"].cardKeys).toEqual(["a:two"]);
    expect(projects["other-app"].writtenAt).toBe("2026-10-13T15:00:01.000Z");
  });

  it("rewrites an unchanged entry only once a minute has passed", async () => {
    expect(await recordLiveList(entry("notes-app", "2026-10-13T15:00:00.000Z"))).toBe(true);
    expect(await recordLiveList(entry("notes-app", "2026-10-13T15:00:30.000Z"))).toBe(false);
    expect(await recordLiveList(entry("notes-app", "2026-10-13T15:01:00.000Z"))).toBe(true);
    expect(JSON.parse(readFileSync(liveListPath(), "utf8")).projects["notes-app"].writtenAt).toBe("2026-10-13T15:01:00.000Z");
  });
});
