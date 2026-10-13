import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Stats } from "./stats";

const agent = { id: "agent-1", role: "owner", model: "claude/claude-sonnet-5-5", title: "TR-1 owner" };
const start = Date.parse("2026-10-13T10:00:00Z");
let home = "";

async function statsFile(): Promise<{ tickets: Record<string, { agents: Record<string, { turns: number; activeMs: number }> }>; turnStarts: Record<string, string> }> {
  return JSON.parse(await readFile(join(home, "plugin-data", "taro", "state", "stats.json"), "utf8"));
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-stats-"));
  vi.stubEnv("PASEO_HOME", home);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe("turn durations", () => {
  it("survive a reload: a fresh Stats on the same files pairs the end with the stored start", async () => {
    await new Stats().turnStarted(agent.id);
    vi.setSystemTime(start + 11.9 * 60_000);
    await new Stats().turnEnded("taro", "TR-1", agent);
    const file = await statsFile();
    expect(file.tickets["taro:TR-1"]?.agents[agent.id]).toMatchObject({ turns: 1, activeMs: 11.9 * 60_000 });
    expect(file.turnStarts).toEqual({});
  });

  it("count a child ticket's turn toward its parent with the same duration", async () => {
    const stats = new Stats();
    await stats.turnStarted(agent.id);
    vi.setSystemTime(start + 5_000);
    await stats.turnEnded("taro", "TR-1.2", agent);
    const file = await statsFile();
    expect(file.tickets["taro:TR-1.2"]?.agents[agent.id]?.activeMs).toBe(5_000);
    expect(file.tickets["taro:TR-1"]?.agents[agent.id]?.activeMs).toBe(5_000);
  });

  it("count a turn without a recorded start, with no duration", async () => {
    await new Stats().turnEnded("taro", "TR-1", agent);
    expect((await statsFile()).tickets["taro:TR-1"]?.agents[agent.id]).toMatchObject({ turns: 1, activeMs: 0 });
  });

  it("never go negative when the clock moved backwards", async () => {
    const stats = new Stats();
    await stats.turnStarted(agent.id);
    vi.setSystemTime(start - 1_000);
    await stats.turnEnded("taro", "TR-1", agent);
    expect((await statsFile()).tickets["taro:TR-1"]?.agents[agent.id]?.activeMs).toBe(0);
  });

  it("use only the latest start when a turn starts again", async () => {
    const stats = new Stats();
    await stats.turnStarted(agent.id);
    vi.setSystemTime(start + 60_000);
    await stats.turnStarted(agent.id);
    vi.setSystemTime(start + 90_000);
    await stats.turnEnded("taro", "TR-1", agent);
    expect((await statsFile()).tickets["taro:TR-1"]?.agents[agent.id]?.activeMs).toBe(30_000);
  });

  it("forget the start of an agent outside Taro", async () => {
    const stats = new Stats();
    await stats.turnStarted("other");
    await stats.discardTurnStart("other");
    expect((await statsFile()).turnStarts).toEqual({});
  });
});

describe("stats file", () => {
  it("loads a file written before turn starts were stored, keeping its tickets", async () => {
    await mkdir(join(home, "plugin-data", "taro", "state"), { recursive: true });
    const old = { tickets: { "taro:TR-1": { project: "taro", ticket: "TR-1", title: "Old", agents: { [agent.id]: { ...agent, agentId: agent.id, turns: 3, activeMs: 1_000 } } } } };
    await writeFile(join(home, "plugin-data", "taro", "state", "stats.json"), JSON.stringify(old));
    const stats = new Stats();
    expect((await stats.all("taro"))[0]?.agents[agent.id]).toMatchObject({ turns: 3, activeMs: 1_000 });
    await stats.turnStarted(agent.id);
    vi.setSystemTime(start + 2_000);
    await stats.turnEnded("taro", "TR-1", agent);
    expect((await statsFile()).tickets["taro:TR-1"]?.agents[agent.id]).toMatchObject({ turns: 4, activeMs: 3_000 });
  });
});

describe("dropFinishedTurns", () => {
  it("drops starts of agents that are idle after a restart, so the idle gap is never counted", async () => {
    await new Stats().turnStarted("idle");
    await new Stats().turnStarted("running");
    const stats = new Stats();
    expect(await stats.dropFinishedTurns(async (agentId) => agentId === "running")).toBe(1);
    expect(Object.keys((await statsFile()).turnStarts)).toEqual(["running"]);
    vi.setSystemTime(start + 60 * 60_000);
    await stats.turnEnded("taro", "TR-1", { ...agent, id: "idle" });
    expect((await statsFile()).tickets["taro:TR-1"]?.agents.idle).toMatchObject({ turns: 1, activeMs: 0 });
  });

  it("keeps a start the check could not confirm, and one replaced while it ran", async () => {
    const stats = new Stats();
    await stats.turnStarted("unknown");
    await stats.turnStarted("restarted");
    const dropped = await stats.dropFinishedTurns(async (agentId) => {
      if (agentId === "unknown") throw new Error("Paseo unreachable");
      vi.setSystemTime(start + 1_000);
      await stats.turnStarted("restarted");
      return false;
    });
    expect(dropped).toBe(0);
    expect((await statsFile()).turnStarts).toEqual({ unknown: new Date(start).toISOString(), restarted: new Date(start + 1_000).toISOString() });
  });

  it("does nothing without stored starts", async () => {
    expect(await new Stats().dropFinishedTurns(async () => false)).toBe(0);
  });
});
