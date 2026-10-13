import { describe, expect, it } from "vitest";

import type { ProjectConfig } from "./project";
import { draftFrom, parseCount, settingsFrom, setupProblems, ticketExample, type SetupDraft } from "./setup-form";

const config: ProjectConfig = {
  schemaVersion: 1,
  project: "sample-app",
  paseoProjectId: "p1",
  managerAgentId: "",
  managerWorkspaceId: "",
  repoPath: "/home/you/code/sample-app",
  baseBranch: "develop",
  ticketPrefix: "SA",
  manager: { model: "claude/sonnet", thinking: "medium" },
  owner: { model: "claude/opus", thinking: "" },
  subagentModels: ["claude/haiku"],
  delivery: "local-only",
  acceptAlsoMerges: false,
  trackerSync: "remote",
  compactThresholdTokens: 300_000,
  idleCompactThresholdTokens: 150_000,
  maxParallelOwners: 5,
};

function validNew(overrides: Partial<SetupDraft> = {}): SetupDraft {
  return { ...draftFrom(null), project: "sample-app", repoPath: "/home/you/code/sample-app", ticketPrefix: "SA", ...overrides };
}

describe("draftFrom and settingsFrom", () => {
  it("round-trips an existing project's settings unchanged", () => {
    const { schemaVersion, project, paseoProjectId, managerAgentId, managerWorkspaceId, ...settings } = config;
    expect(settingsFrom(draftFrom(config), "claude/opus")).toEqual(settings);
  });

  it("gives a new project the defaults and the default model", () => {
    const settings = settingsFrom(validNew({ ticketPrefix: " sa " }), "claude/opus");
    expect(settings).toMatchObject({
      baseBranch: "main",
      ticketPrefix: "SA",
      manager: { model: "claude/opus", thinking: "" },
      owner: { model: "claude/opus", thinking: "" },
      delivery: "pull-request",
      acceptAlsoMerges: true,
      trackerSync: "local",
      compactThresholdTokens: 250_000,
      idleCompactThresholdTokens: 200_000,
      maxParallelOwners: 3,
    });
  });

  it("trims text fields and reads counts with separators", () => {
    const settings = settingsFrom(validNew({ repoPath: " /srv/app ", baseBranch: " trunk ", compactThresholdTokens: "180,000", maxParallelOwners: " 2 " }), "m");
    expect(settings.repoPath).toBe("/srv/app");
    expect(settings.baseBranch).toBe("trunk");
    expect(settings.compactThresholdTokens).toBe(180_000);
    expect(settings.maxParallelOwners).toBe(2);
  });
});

describe("parseCount", () => {
  it("accepts whole positive numbers with separators", () => {
    expect(parseCount("1")).toBe(1);
    expect(parseCount("250,000")).toBe(250_000);
    expect(parseCount("250 000")).toBe(250_000);
    expect(parseCount("250_000")).toBe(250_000);
  });

  it("refuses empty, zero, negative, fractional and non-numeric input", () => {
    for (const text of ["", "  ", "0", "-5", "2.5", "1e5", "abc", "12abc"]) expect(parseCount(text)).toBeNull();
  });

  it("refuses numbers past the safe integer range", () => {
    expect(parseCount("99999999999999999999")).toBeNull();
  });
});

describe("setupProblems", () => {
  it("finds nothing wrong with a filled new project", () => {
    expect(setupProblems(validNew(), true)).toEqual({});
  });

  it("requires a name, an absolute repository path and a prefix for a new project", () => {
    const problems = setupProblems(draftFrom(null), true);
    expect(Object.keys(problems).sort()).toEqual(["project", "repoPath", "ticketPrefix"]);
  });

  it("explains a bad name, relative path and bad prefix", () => {
    const problems = setupProblems(validNew({ project: "Sample App", repoPath: "code/app", ticketPrefix: "S1" }), true);
    expect(problems.project).toMatch(/lowercase/);
    expect(problems.repoPath).toMatch(/absolute/);
    expect(problems.ticketPrefix).toMatch(/capital/);
  });

  it("accepts a lowercase prefix, since it is saved in capitals", () => {
    expect(setupProblems(validNew({ ticketPrefix: "sa" }), true).ticketPrefix).toBeUndefined();
  });

  it("does not check the fixed fields of an existing project", () => {
    expect(setupProblems({ ...draftFrom(config), project: "", repoPath: "", ticketPrefix: "" }, false)).toEqual({});
  });

  it("checks the branch and every count", () => {
    const problems = setupProblems({ ...draftFrom(config), baseBranch: " ", compactThresholdTokens: "0", idleCompactThresholdTokens: "x", maxParallelOwners: "21" }, false);
    expect(Object.keys(problems).sort()).toEqual(["baseBranch", "compactThresholdTokens", "idleCompactThresholdTokens", "maxParallelOwners"]);
  });

  it("allows the owner count at its bounds", () => {
    expect(setupProblems({ ...draftFrom(config), maxParallelOwners: "1" }, false)).toEqual({});
    expect(setupProblems({ ...draftFrom(config), maxParallelOwners: "20" }, false)).toEqual({});
    expect(setupProblems({ ...draftFrom(config), maxParallelOwners: "0" }, false).maxParallelOwners).toBeDefined();
  });
});

describe("ticketExample", () => {
  it("shows the first ticket id for a usable prefix, in capitals", () => {
    expect(ticketExample("ab")).toBe("AB-001");
    expect(ticketExample(" ABCDEFGH ")).toBe("ABCDEFGH-001");
  });

  it("is null for an empty or unusable prefix", () => {
    for (const prefix of ["", "A1", "ABCDEFGHI", "A-B"]) expect(ticketExample(prefix)).toBeNull();
  });
});
