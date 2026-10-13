import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { taroEnvironment } from "./environment";

vi.mock("./package-files", () => ({ skillDirectory: async () => "/skill" }));
vi.mock("./projects", () => ({ projectPaths: vi.fn(), projectsDirectory: vi.fn() }));

describe("taroEnvironment", () => {
  it("gives every agent the project's evidence folder", async () => {
    process.env.PASEO_HOME = "/home/x/.paseo";
    const env = await taroEnvironment("notes", "/tracker");
    expect(env.TARO_EVIDENCE).toBe(join("/home/x/.paseo", "plugin-data", "taro", "evidence", "notes"));
    expect(env.TARO_SKILL).toBe("/skill");
  });
});
