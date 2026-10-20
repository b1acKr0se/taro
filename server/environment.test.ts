import { delimiter, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { pathWithTaro, projectForSession, taroEnvironment } from "./environment";
import type { PaseoApi } from "./host-types";
import { projectsDirectory, readProjectConfig } from "./projects";

vi.mock("./package-files", () => ({ skillDirectory: async () => "/skill", packageDirectory: async () => "/plugins/taro" }));
vi.mock("./projects", () => ({ projectPaths: vi.fn(), projectsDirectory: vi.fn(), readProjectConfig: vi.fn() }));

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

describe("projectForSession", () => {
  const known = new Set(["notes"]);
  vi.mocked(projectsDirectory).mockResolvedValue("/data/projects");
  vi.mocked(readProjectConfig).mockImplementation(async (project) => (known.has(project) ? ({ project } as never) : null));
  const paseoWith = (refresh: () => Promise<unknown>) => ({ agents: { ref: () => ({ refresh }) } }) as unknown as PaseoApi;
  const unreadable = paseoWith(async () => {
    throw new Error("unknown agent");
  });
  const unlabelled = paseoWith(async () => ({ agent: { labels: {} } }));

  it("knows a manager by its home and a labelled agent by its label", async () => {
    expect(await projectForSession(unreadable, "a1", "/data/projects/notes/home")).toBe("notes");
    expect(await projectForSession(paseoWith(async () => ({ agent: { labels: { "taro.project": "shop" } } })), "a1", "/work/tr-1", "notes")).toBe("shop");
  });

  // TR-206: a new owner's labels are not readable as its session opens; it went without `taro` on PATH.
  it("falls back to the TARO_PROJECT its launcher passed, when its labels say nothing", async () => {
    expect(await projectForSession(unreadable, "a1", "/work/tr-1", "notes")).toBe("notes");
    expect(await projectForSession(unlabelled, "a1", "/work/tr-1", "notes")).toBe("notes");
  });

  it("ignores a passed project Taro does not have, or a name that is not a project name", async () => {
    expect(await projectForSession(unreadable, "a1", "/work/tr-1", "other")).toBeNull();
    expect(await projectForSession(unreadable, "a1", "/work/tr-1", "../notes")).toBeNull();
    expect(await projectForSession(unreadable, "a1", "/work/tr-1", "")).toBeNull();
    expect(await projectForSession(unreadable, "a1", "/work/tr-1")).toBeNull();
  });
});
