import { describe, expect, it } from "vitest";

import { ProjectSettingsSchema } from "./project";
import { IDLE_COMPACT_AFTER_MS, idleCompactAfterMs, idleCompactionAfterTurn, idleCompactionDue, type IdleCandidate } from "./idle-compaction";

const endedAt = Date.parse("2026-10-13T12:00:00Z");
const minutes = (count: number) => endedAt + count * 60_000;

function candidate(values: Partial<IdleCandidate> = {}): IdleCandidate {
  return {
    role: "owner",
    status: "idle",
    pendingPermissions: 0,
    stage: "none",
    idle: "none",
    lastTurnEndedAt: new Date(endedAt).toISOString(),
    usedTokens: 150_000,
    ...values,
  };
}

describe("idleCompactionDue", () => {
  it("is due for an owner or the manager from 55 minutes idle until 60", () => {
    for (const role of ["owner", "manager"] as const) {
      expect(idleCompactionDue(candidate({ role }), 100_000, minutes(55))).toBe(true);
      expect(idleCompactionDue(candidate({ role }), 100_000, minutes(59.9))).toBe(true);
    }
  });

  it("is not due before 55 minutes, or from 60 on when the cache is cold", () => {
    expect(idleCompactionDue(candidate(), 100_000, minutes(54.9))).toBe(false);
    expect(idleCompactionDue(candidate(), 100_000, minutes(60))).toBe(false);
    expect(idleCompactionDue(candidate(), 100_000, minutes(180))).toBe(false);
    // A clock behind the stored turn end.
    expect(idleCompactionDue(candidate(), 100_000, minutes(-5))).toBe(false);
  });

  it("is never due for subagents", () => {
    expect(idleCompactionDue(candidate({ role: "implementer" }), 100_000, minutes(56))).toBe(false);
    expect(idleCompactionDue(candidate({ role: "reviewer" }), 100_000, minutes(56))).toBe(false);
  });

  it("needs a context above the threshold, and a known one", () => {
    expect(idleCompactionDue(candidate({ usedTokens: 100_000 }), 100_000, minutes(56))).toBe(false);
    expect(idleCompactionDue(candidate({ usedTokens: 100_001 }), 100_000, minutes(56))).toBe(true);
    expect(idleCompactionDue(candidate({ usedTokens: 0 }), 100_000, minutes(56))).toBe(false);
    expect(idleCompactionDue(candidate({ usedTokens: null }), 100_000, minutes(56))).toBe(false);
    expect(idleCompactionDue(candidate({ usedTokens: undefined }), 100_000, minutes(56))).toBe(false);
  });

  it("needs a plain idle agent: not running, failed, closed, asking permission or already compacting", () => {
    for (const status of ["running", "initializing", "error", "closed"]) {
      expect(idleCompactionDue(candidate({ status }), 100_000, minutes(56))).toBe(false);
    }
    expect(idleCompactionDue(candidate({ pendingPermissions: 1 }), 100_000, minutes(56))).toBe(false);
    for (const stage of ["handoff", "compacting", "reloading"] as const) {
      expect(idleCompactionDue(candidate({ stage }), 100_000, minutes(56))).toBe(false);
    }
  });

  it("is not due again until the agent ends a turn of its own after the last one", () => {
    expect(idleCompactionDue(candidate({ idle: "running" }), 100_000, minutes(56))).toBe(false);
    expect(idleCompactionDue(candidate({ idle: "done" }), 100_000, minutes(56))).toBe(false);
  });

  it("needs a known turn end", () => {
    expect(idleCompactionDue(candidate({ lastTurnEndedAt: null }), 100_000, minutes(56))).toBe(false);
    expect(idleCompactionDue(candidate({ lastTurnEndedAt: "not a time" }), 100_000, minutes(56))).toBe(false);
  });

  it("takes a shorter idle time for a test daemon, with the same five-minute window", () => {
    expect(idleCompactionDue(candidate(), 100_000, endedAt + 60_000, 60_000)).toBe(true);
    expect(idleCompactionDue(candidate(), 100_000, endedAt + 6 * 60_000, 60_000)).toBe(false);
  });
});

describe("idleCompactionAfterTurn", () => {
  it("walks running → done → none across the pipeline's turns and the next one", () => {
    // Handoff turn ends in stage handoff, /compact's in compacting: still running.
    expect(idleCompactionAfterTurn("running", "handoff")).toBe("running");
    expect(idleCompactionAfterTurn("running", "compacting")).toBe("running");
    // The reload's turn.
    expect(idleCompactionAfterTurn("running", "none")).toBe("done");
    // The first turn the pipeline did not cause.
    expect(idleCompactionAfterTurn("done", "none")).toBe("none");
    expect(idleCompactionAfterTurn("none", "none")).toBe("none");
  });

  it("keeps done while a turn-end compaction runs after it", () => {
    expect(idleCompactionAfterTurn("done", "handoff")).toBe("done");
  });
});

describe("idleCompactAfterMs", () => {
  it("is 55 minutes unless a positive number of seconds overrides it", () => {
    expect(idleCompactAfterMs(undefined)).toBe(IDLE_COMPACT_AFTER_MS);
    expect(idleCompactAfterMs("")).toBe(IDLE_COMPACT_AFTER_MS);
    expect(idleCompactAfterMs("0")).toBe(IDLE_COMPACT_AFTER_MS);
    expect(idleCompactAfterMs("-5")).toBe(IDLE_COMPACT_AFTER_MS);
    expect(idleCompactAfterMs("soon")).toBe(IDLE_COMPACT_AFTER_MS);
    expect(idleCompactAfterMs("90")).toBe(90_000);
  });
});

describe("idleCompactThresholdTokens", () => {
  it("defaults to 200k, for a project configured before the setting existed too", () => {
    const settings = ProjectSettingsSchema.parse({
      repoPath: "/repo",
      baseBranch: "main",
      ticketPrefix: "AP",
      manager: { model: "claude/claude-haiku-5-5" },
      owner: { model: "claude/claude-haiku-5-5" },
    });
    expect(settings.idleCompactThresholdTokens).toBe(200_000);
    expect(settings.compactThresholdTokens).toBe(250_000);
  });
});
