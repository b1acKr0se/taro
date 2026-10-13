import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Stats, turnMayStillEnd } from "./stats";

const agent = { id: "agent-1", role: "owner", model: "claude/claude-sonnet-5-5", title: "TR-1 owner" };
const start = Date.parse("2026-10-13T10:00:00Z");
let home = "";

/** What the turn-end hook does: take the duration, then record the turn. */
async function endTurn(stats: Stats, ticket: string | null, ended = agent): Promise<void> {
  await stats.turnEnded("taro", ticket, ended, await stats.takeTurnDuration(ended.id));
}

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
    await endTurn(new Stats(), "TR-1");
    const file = await statsFile();
    expect(file.tickets["taro:TR-1"]?.agents[agent.id]).toMatchObject({ turns: 1, activeMs: 11.9 * 60_000 });
    expect(file.turnStarts).toEqual({});
  });

  it("count a child ticket's turn toward its parent with the same duration", async () => {
    const stats = new Stats();
    await stats.turnStarted(agent.id);
    vi.setSystemTime(start + 5_000);
    await endTurn(stats, "TR-1.2");
    const file = await statsFile();
    expect(file.tickets["taro:TR-1.2"]?.agents[agent.id]?.activeMs).toBe(5_000);
    expect(file.tickets["taro:TR-1"]?.agents[agent.id]?.activeMs).toBe(5_000);
  });

  it("count a turn without a recorded start, with no duration", async () => {
    await endTurn(new Stats(), "TR-1");
    expect((await statsFile()).tickets["taro:TR-1"]?.agents[agent.id]).toMatchObject({ turns: 1, activeMs: 0 });
  });

  it("never go negative when the clock moved backwards", async () => {
    const stats = new Stats();
    await stats.turnStarted(agent.id);
    vi.setSystemTime(start - 1_000);
    await endTurn(stats, "TR-1");
    expect((await statsFile()).tickets["taro:TR-1"]?.agents[agent.id]?.activeMs).toBe(0);
  });

  it("use only the latest start when a turn starts again", async () => {
    const stats = new Stats();
    await stats.turnStarted(agent.id);
    vi.setSystemTime(start + 60_000);
    await stats.turnStarted(agent.id);
    vi.setSystemTime(start + 90_000);
    await endTurn(stats, "TR-1");
    expect((await statsFile()).tickets["taro:TR-1"]?.agents[agent.id]?.activeMs).toBe(30_000);
  });

  it("forget the start of an agent outside Taro (no ticket) at its end", async () => {
    const stats = new Stats();
    await stats.turnStarted("other");
    await endTurn(stats, null, { ...agent, id: "other" });
    const file = await statsFile();
    expect(file.turnStarts).toEqual({});
    expect(file.tickets).toEqual({});
  });

  it("keep the start of a turn that begins while the previous end is being recorded (a nudge)", async () => {
    const stats = new Stats();
    await stats.turnStarted(agent.id);
    vi.setSystemTime(start + 10_000);
    const activeMs = await stats.takeTurnDuration(agent.id);
    vi.setSystemTime(start + 11_000);
    await stats.turnStarted(agent.id);
    await stats.turnEnded("taro", "TR-1", agent, activeMs);
    const file = await statsFile();
    expect(file.tickets["taro:TR-1"]?.agents[agent.id]?.activeMs).toBe(10_000);
    expect(file.turnStarts).toEqual({ [agent.id]: new Date(start + 11_000).toISOString() });
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
    await endTurn(stats, "TR-1");
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
    await endTurn(stats, "TR-1", { ...agent, id: "idle" });
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

  it("never drops a start a turn end took first, even when the agent looks idle", async () => {
    await new Stats().turnStarted(agent.id);
    const stats = new Stats();
    vi.setSystemTime(start + 30_000);
    const taking = stats.takeTurnDuration(agent.id);
    const dropping = stats.dropFinishedTurns(async () => false);
    await stats.turnEnded("taro", "TR-1", agent, await taking);
    expect(await dropping).toBe(0);
    expect((await statsFile()).tickets["taro:TR-1"]?.agents[agent.id]?.activeMs).toBe(30_000);
  });

  it("does nothing without stored starts", async () => {
    expect(await new Stats().dropFinishedTurns(async () => false)).toBe(0);
  });
});

describe("turnMayStillEnd", () => {
  const pluginStartedAt = Date.parse("2026-10-13T12:00:00Z");

  it("keeps a mid-turn agent's start", () => {
    expect(turnMayStillEnd({ status: "running", updatedAt: "2026-10-13T09:00:00Z" }, pluginStartedAt)).toBe(true);
    expect(turnMayStillEnd({ status: "initializing", updatedAt: "2026-10-13T09:00:00Z" }, pluginStartedAt)).toBe(true);
  });

  it("drops the start of an agent that went idle before the plugin started", () => {
    expect(turnMayStillEnd({ status: "idle", updatedAt: "2026-10-13T11:59:59.999Z" }, pluginStartedAt)).toBe(false);
  });

  it("keeps the start of an agent that went idle since the plugin started: its turn-end hook is on the way", () => {
    expect(turnMayStillEnd({ status: "idle", updatedAt: "2026-10-13T12:00:00Z" }, pluginStartedAt)).toBe(true);
    expect(turnMayStillEnd({ status: "error", updatedAt: "2026-10-13T12:00:05Z" }, pluginStartedAt)).toBe(true);
  });

  it("drops the start of a missing agent, or one with an unreadable time", () => {
    expect(turnMayStillEnd(null, pluginStartedAt)).toBe(false);
    expect(turnMayStillEnd({ status: "idle", updatedAt: "" }, pluginStartedAt)).toBe(false);
  });
});
