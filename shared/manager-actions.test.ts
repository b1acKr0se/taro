import { describe, expect, it } from "vitest";

import { MANAGER_ACTION_LABELS, managerPaneNotice, managerSettingsActions, offersReplaceManager, PROMPT_CACHE_MS, replaceManagerNotice } from "./manager-actions";

describe("managerSettingsActions", () => {
  it("offers only Start manager when there is none", () => {
    expect(managerSettingsActions(null).kinds).toEqual(["launch"]);
  });

  it("offers Resume first and a fresh start, saying the old conversation is archived, not deleted", () => {
    for (const status of ["idle", "error", "running"]) {
      const { kinds, description } = managerSettingsActions({ status });
      expect(kinds).toEqual(["resume", "fresh"]);
      expect(description).toContain("its conversation kept");
      expect(description).toContain("archived, not deleted");
    }
    expect(kinds()).toEqual(["Resume manager", "Start a fresh manager"]);
  });

  it("says a crashed manager stopped with an error", () => {
    expect(managerSettingsActions({ status: "error" }).description).toMatch(/^The manager stopped with an error\. /);
    expect(managerSettingsActions({ status: "idle" }).description).not.toContain("error");
  });
});

describe("managerPaneNotice", () => {
  it("points a crashed manager to Resume, and says nothing otherwise", () => {
    expect(managerPaneNotice({ status: "error" })).toContain("Resume manager");
    expect(managerPaneNotice({ status: "idle" })).toBeNull();
    expect(managerPaneNotice({ status: "running" })).toBeNull();
    expect(managerPaneNotice(null)).toBeNull();
  });
});

function kinds(): string[] {
  return managerSettingsActions({ status: "error" }).kinds.map((kind) => MANAGER_ACTION_LABELS[kind]);
}

describe("offersReplaceManager (TR-128)", () => {
  const now = Date.parse("2026-01-05T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const idle = (contextUsedTokens: number | null, status = "idle") => ({ status, contextUsedTokens });

  it("offers it once idle for the whole cache hour with over 100k tokens", () => {
    expect(offersReplaceManager(idle(100_001), ago(PROMPT_CACHE_MS), now)).toBe(true);
    expect(offersReplaceManager(idle(950_000), ago(3 * PROMPT_CACHE_MS), now)).toBe(true);
  });

  it("not within the hour, while the cache is still warm", () => {
    expect(offersReplaceManager(idle(500_000), ago(PROMPT_CACHE_MS - 1), now)).toBe(false);
    expect(offersReplaceManager(idle(500_000), ago(0), now)).toBe(false);
  });

  it("not at 100k or under, nor with no usage reported", () => {
    expect(offersReplaceManager(idle(100_000), ago(2 * PROMPT_CACHE_MS), now)).toBe(false);
    expect(offersReplaceManager(idle(0), ago(2 * PROMPT_CACHE_MS), now)).toBe(false);
    expect(offersReplaceManager(idle(null), ago(2 * PROMPT_CACHE_MS), now)).toBe(false);
  });

  it("not unless idle: mid-turn, starting, crashed or absent", () => {
    for (const status of ["running", "initializing", "error", "closed"]) expect(offersReplaceManager(idle(500_000, status), ago(2 * PROMPT_CACHE_MS), now)).toBe(false);
    expect(offersReplaceManager(null, ago(2 * PROMPT_CACHE_MS), now)).toBe(false);
  });

  it("not when the last turn's end is unknown or unreadable", () => {
    expect(offersReplaceManager(idle(500_000), null, now)).toBe(false);
    expect(offersReplaceManager(idle(500_000), "not a time", now)).toBe(false);
  });

  it("says why and what replacing keeps", () => {
    const text = replaceManagerNotice("142k");
    expect(text).toContain("142k tokens");
    expect(text).toContain("uncached");
    expect(text).toContain("tickets are kept");
  });
});
