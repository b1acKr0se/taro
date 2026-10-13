import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listProjectConfigs, readProjectConfig, updateProjectConfig } from "./projects";

let home = "";
vi.mock("./config", () => ({ readGlobalConfig: async () => ({}), resolveTaroHome: () => home }));

// A taro.json saved before TR-017, when the subagent models were `helperModels`.
const legacy = {
  schemaVersion: 1,
  project: "app",
  paseoProjectId: "prj_1",
  repoPath: "/repo",
  baseBranch: "main",
  ticketPrefix: "AP",
  manager: { model: "claude/opus", thinking: "" },
  owner: { model: "claude/opus", thinking: "" },
  helperModels: ["claude/sonnet", "claude/haiku"],
};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-projects-"));
  await mkdir(join(home, "projects", "app"), { recursive: true });
  await writeFile(join(home, "projects", "app", "taro.json"), JSON.stringify(legacy), "utf8");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("a taro.json saved with helperModels", () => {
  it("loads its models as subagentModels", async () => {
    expect((await readProjectConfig("app"))?.subagentModels).toEqual(["claude/sonnet", "claude/haiku"]);
    expect((await listProjectConfigs()).map((config) => config.subagentModels)).toEqual([["claude/sonnet", "claude/haiku"]]);
  });

  it("is written back under the new key on the next save, models kept", async () => {
    await updateProjectConfig("app", { maxParallelOwners: 2 });
    const stored = JSON.parse(await readFile(join(home, "projects", "app", "taro.json"), "utf8")) as Record<string, unknown>;
    expect(stored.subagentModels).toEqual(["claude/sonnet", "claude/haiku"]);
    expect("helperModels" in stored).toBe(false);
    expect(stored.maxParallelOwners).toBe(2);
  });
});
