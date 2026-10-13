import { describe, expect, it } from "vitest";

import { isSubagentRole, migrateStoredConfig, ProjectConfigSchema, roleFromLabel, RoleSchema } from "./project";
import { AgentStateSchema } from "./state";

const config = {
  schemaVersion: 1,
  project: "app",
  paseoProjectId: "p",
  repoPath: "/repo",
  baseBranch: "main",
  ticketPrefix: "AP",
  manager: { model: "claude/opus" },
  owner: { model: "claude/opus" },
};

describe("roleFromLabel", () => {
  it("reads every role by its job", () => {
    expect(["manager", "owner", "implementer", "reviewer", "researcher"].map(roleFromLabel)).toEqual(["manager", "owner", "implementer", "reviewer", "researcher"]);
  });

  it("reads the label `helper` from before TR-017 as an implementer", () => {
    expect(roleFromLabel("helper")).toBe("implementer");
  });

  it("is null for a missing, empty or unknown label", () => {
    expect(roleFromLabel(undefined)).toBeNull();
    expect(roleFromLabel("")).toBeNull();
    expect(roleFromLabel("pilot")).toBeNull();
    expect(roleFromLabel("Implementer")).toBeNull();
  });
});

describe("isSubagentRole", () => {
  it("is true for the jobs an owner launches only", () => {
    expect(["manager", "owner", "implementer", "reviewer", "researcher", "helper"].map(isSubagentRole)).toEqual([false, false, true, true, true, false]);
  });
});

describe("stored roles", () => {
  it("load `helper` as an implementer", () => {
    expect(RoleSchema.parse("helper")).toBe("implementer");
    expect(AgentStateSchema.parse({ project: "app", role: "helper" }).role).toBe("implementer");
    expect(RoleSchema.safeParse("pilot").success).toBe(false);
  });
});

describe("migrateStoredConfig", () => {
  it("keeps the subagent models of a taro.json saved as helperModels", () => {
    const parsed = ProjectConfigSchema.parse(migrateStoredConfig({ ...config, helperModels: ["claude/sonnet", "claude/haiku"] }));
    expect(parsed.subagentModels).toEqual(["claude/sonnet", "claude/haiku"]);
    expect("helperModels" in parsed).toBe(false);
  });

  it("prefers subagentModels when both keys are present", () => {
    expect(ProjectConfigSchema.parse(migrateStoredConfig({ ...config, helperModels: ["old"], subagentModels: ["new"] })).subagentModels).toEqual(["new"]);
  });

  it("leaves a current config, an empty list and a non-object alone", () => {
    expect(ProjectConfigSchema.parse(migrateStoredConfig({ ...config, subagentModels: ["claude/sonnet"] })).subagentModels).toEqual(["claude/sonnet"]);
    expect(ProjectConfigSchema.parse(migrateStoredConfig({ ...config, helperModels: [] })).subagentModels).toEqual([]);
    expect(ProjectConfigSchema.parse(migrateStoredConfig(config)).subagentModels).toEqual([]);
    expect(migrateStoredConfig(null)).toBeNull();
    expect(migrateStoredConfig("x")).toBe("x");
  });
});
