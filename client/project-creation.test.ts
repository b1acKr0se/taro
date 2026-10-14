import { describe, expect, it, vi } from "vitest";

import { draftFrom, settingsFrom } from "../shared/setup-form";
import { creationDefaults, resetCreation, retryManager, startCreation, type CreationCalls } from "./project-creation";

const settings = settingsFrom({ ...draftFrom(null), repoPath: "/home/you/code/shop", ticketPrefix: "SH" }, "claude/opus");

function calls(overrides: Partial<CreationCalls> = {}): CreationCalls {
  return {
    check: vi.fn(async () => ({ problems: {} })),
    onboard: vi.fn(async () => ({})),
    launch: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe("startCreation", () => {
  it("creates nothing and returns the problems when the check finds any", async () => {
    const state = creationDefaults();
    const fake = calls({ check: vi.fn(async () => ({ problems: { baseBranch: "The repository has no branch named main." } })) });
    const result = await startCreation(fake, "shop", settings, state);
    await result.finished;
    expect(result.problems).toEqual({ baseBranch: "The repository has no branch named main." });
    expect(fake.onboard).not.toHaveBeenCalled();
    expect(state).toEqual(creationDefaults());
  });

  it("sets up the tracker without the Manager, then starts the Manager, then is done", async () => {
    const state = creationDefaults();
    let finishTracker: () => void = () => {};
    let finishManager: () => void = () => {};
    const fake = calls({
      onboard: vi.fn(() => new Promise((resolve) => (finishTracker = () => resolve({})))),
      launch: vi.fn(() => new Promise((resolve) => (finishManager = () => resolve({})))),
    });
    const result = await startCreation(fake, "shop", settings, state);
    expect(result.problems).toBeNull();
    expect(state).toMatchObject({ project: "shop", step: "tracker" });
    expect(fake.onboard).toHaveBeenCalledWith({ project: "shop", settings, startManager: false });
    finishTracker();
    await vi.waitFor(() => expect(state.step).toBe("manager"));
    expect(fake.launch).toHaveBeenCalledWith({ project: "shop" });
    finishManager();
    await result.finished;
    expect(state).toEqual({ project: "shop", step: "done", failedStep: null, error: null });
  });

  it("records which step failed and why", async () => {
    const tracker = creationDefaults();
    await (await startCreation(calls({ onboard: vi.fn(async () => Promise.reject(new Error("git failed"))) }), "shop", settings, tracker)).finished;
    expect(tracker).toEqual({ project: "shop", step: "failed", failedStep: "tracker", error: "git failed" });

    const manager = creationDefaults();
    const fake = calls({ launch: vi.fn(async () => Promise.reject(new Error("no threads"))) });
    await (await startCreation(fake, "shop", settings, manager)).finished;
    expect(manager).toEqual({ project: "shop", step: "failed", failedStep: "manager", error: "no threads" });
  });

  it("lets a check failure reach the caller with nothing started", async () => {
    const state = creationDefaults();
    await expect(startCreation(calls({ check: vi.fn(async () => Promise.reject(new Error("offline"))) }), "shop", settings, state)).rejects.toThrow("offline");
    expect(state.step).toBe("idle");
  });
});

describe("retryManager", () => {
  it("starts the Manager again and is done, or fails again", async () => {
    const state = { project: "shop", step: "failed" as const, failedStep: "manager" as const, error: "no threads" };
    const failing = { launch: vi.fn(async () => Promise.reject(new Error("still none"))) };
    await retryManager(failing, state);
    expect(state).toEqual({ project: "shop", step: "failed", failedStep: "manager", error: "still none" });
    await retryManager({ launch: vi.fn(async () => ({})) }, state);
    expect(state).toEqual({ project: "shop", step: "done", failedStep: null, error: null });
  });

  it("does nothing without a project", async () => {
    const launch = vi.fn(async () => ({}));
    const state = creationDefaults();
    await retryManager({ launch }, state);
    expect(launch).not.toHaveBeenCalled();
    resetCreation(state);
    expect(state).toEqual(creationDefaults());
  });
});
