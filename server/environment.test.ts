import { delimiter, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { pathWithTaro, taroEnvironment } from "./environment";

vi.mock("./package-files", () => ({ skillDirectory: async () => "/skill", packageDirectory: async () => "/plugins/taro" }));
vi.mock("./projects", () => ({ projectPaths: vi.fn(), projectsDirectory: vi.fn() }));

describe("taroEnvironment", () => {
  it("gives every agent the project's tracker, skill and evidence folder, and the taro command", async () => {
    process.env.PASEO_HOME = "/home/x/.paseo";
    const env = await taroEnvironment("notes", "/tracker", ["/usr/bin", "/bin"].join(delimiter));
    expect(env.TARO_EVIDENCE).toBe(join("/home/x/.paseo", "plugin-data", "taro", "evidence", "notes"));
    expect(env.TARO_SKILL).toBe("/skill");
    expect(env.TARO_TRACKER).toBe("/tracker");
    expect(env.TARO_PROJECT).toBe("notes");
    expect(env.TARO_NODE).toBe(process.execPath);
    expect(env.PATH).toBe([join("/plugins/taro", "bin"), "/usr/bin", "/bin"].join(delimiter));
    expect(Object.keys(env).sort()).toEqual(["PATH", "TARO_EVIDENCE", "TARO_NODE", "TARO_PROJECT", "TARO_SKILL", "TARO_TRACKER"]);
  });

  it("puts the bin folder first once on a resume, whose PATH has it already", async () => {
    const first = await taroEnvironment("notes", "/tracker", ["/usr/bin", "/bin"].join(delimiter));
    const resumed = await taroEnvironment("notes", "/tracker", first.PATH);
    expect(resumed.PATH).toBe(first.PATH);
    expect(pathWithTaro("/b", ["/usr/bin", "/b", "/bin"].join(delimiter))).toBe(["/b", "/usr/bin", "/bin"].join(delimiter));
    expect(pathWithTaro("/b", undefined)).toBe("/b");
  });
});
