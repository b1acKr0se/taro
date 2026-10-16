import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { projectTotals, summarize } from "../shared/stats";
import { Stats, turnMayStillEnd, usageReading } from "./stats";

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

describe("idle compaction counts", () => {
  it("count an owner's on its ticket and the manager's on its project, surviving a reload", async () => {
    await new Stats().count("taro", "TR-1", "idleCompactions");
    await new Stats().countProject("taro", "idleCompactions");
    await new Stats().countProject("taro", "idleCompactions");
    await new Stats().countProject("other", "idleCompactions");
    const stats = new Stats();
    expect((await stats.all("taro"))[0]?.idleCompactions).toBe(1);
    expect(await stats.projectCounts("taro")).toEqual({ idleCompactions: 2 });
    expect(await stats.projectCounts(null)).toEqual({ idleCompactions: 3 });
    expect(await stats.projectCounts("none-yet")).toEqual({ idleCompactions: 0 });
  });

  it("read as zero from a file written before they were counted", async () => {
    await mkdir(join(home, "plugin-data", "taro", "state"), { recursive: true });
    await writeFile(join(home, "plugin-data", "taro", "state", "stats.json"), JSON.stringify({ tickets: { "taro:TR-1": { project: "taro", ticket: "TR-1" } } }));
    const stats = new Stats();
    expect((await stats.all("taro"))[0]?.idleCompactions).toBe(0);
    expect(await stats.projectCounts("taro")).toEqual({ idleCompactions: 0 });
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

describe("agents' cost (TR-097)", () => {
  const subagent = { id: "sub-1", role: "implementer", model: "claude/claude-sonnet-5-5", title: "TR-1.2 implementer" };
  const statsDirectory = () => join(home, "plugin-data", "taro", "state");

  it("is recorded at each turn end, so an agent archived by its owner before the ticket is Done keeps it", async () => {
    const stats = new Stats();
    await stats.turnEnded("taro", "TR-1", subagent, 1_000, { costUsd: 0.4, contextTokens: 20_000 });
    await stats.turnEnded("taro", "TR-1", subagent, 1_000, { costUsd: 1.25, contextTokens: 30_000 });
    // Archived by its owner: Paseo's reading at the archive may be gone (a daemon restart).
    await stats.agentUsage("taro", "TR-1", subagent.id, usageReading(undefined));
    // The ticket's release at Done reads nothing either.
    await stats.agentUsage("taro", "TR-1", subagent.id, { costUsd: null, contextTokens: null });
    expect((await statsFile()).tickets["taro:TR-1"]?.agents[subagent.id]).toMatchObject({ turns: 2, costUsd: 1.25, contextTokens: 30_000 });
  });

  it("keeps the highest reading: Paseo's cost is a running total, and a lower one is stale", async () => {
    const stats = new Stats();
    await stats.turnEnded("taro", "TR-1", subagent, 1_000, { costUsd: 2, contextTokens: null });
    await stats.turnEnded("taro", "TR-1", subagent, 1_000, { costUsd: 0.5, contextTokens: null });
    await stats.agentUsage("taro", "TR-1", subagent.id, { costUsd: 2.5, contextTokens: null });
    expect((await stats.all("taro"))[0]?.agents[subagent.id]?.costUsd).toBe(2.5);
  });

  it("is recorded from Paseo's usage when present", () => {
    expect(usageReading({ totalCostUsd: 3.5, contextWindowUsedTokens: 9, contextWindowMaxTokens: 200_000 })).toEqual({ costUsd: 3.5, contextTokens: 9, contextMaxTokens: 200_000 });
    expect(usageReading({ contextWindowUsedTokens: 9 })).toEqual({ costUsd: null, contextTokens: 9, contextMaxTokens: null });
    expect(usageReading(null)).toEqual({ costUsd: null, contextTokens: null, contextMaxTokens: null });
  });

  it("saves the context window with the used tokens, at a turn end and at the archive, so an archived agent's chat can draw its meter (TR-156)", async () => {
    const stats = new Stats();
    await stats.turnEnded("taro", "TR-1.2", subagent, 1_000, { costUsd: 0.4, contextTokens: 20_000, contextMaxTokens: 200_000 });
    expect((await statsFile()).tickets["taro:TR-1.2"]?.agents[subagent.id]).toMatchObject({ contextTokens: 20_000, contextMaxTokens: 200_000 });
    // The archive's reading has a larger window (a 1M session) and lands on the parent too.
    await stats.agentUsage("taro", "TR-1.2", subagent.id, { costUsd: 0.5, contextTokens: 300_000, contextMaxTokens: 1_000_000 });
    // A reading without a window (an older caller) keeps the saved one.
    await stats.agentUsage("taro", "TR-1.2", subagent.id, { costUsd: null, contextTokens: 310_000 });
    for (const ticket of ["taro:TR-1.2", "taro:TR-1"]) {
      expect((await statsFile()).tickets[ticket]?.agents[subagent.id]).toMatchObject({ contextTokens: 310_000, contextMaxTokens: 1_000_000 });
    }
  });

  it("reads a stats file saved before the window was kept, with no window", async () => {
    await mkdir(statsDirectory(), { recursive: true });
    const old = { agentId: subagent.id, role: "implementer", model: null, title: null, turns: 1, activeMs: 0, costUsd: null, contextTokens: 90_000, startingContextTokens: null };
    await writeFile(join(statsDirectory(), "stats.json"), JSON.stringify({ tickets: { "taro:TR-1": { project: "taro", ticket: "TR-1", agents: { [subagent.id]: old } } } }));
    expect((await new Stats().all("taro"))[0]?.agents[subagent.id]).toMatchObject({ contextTokens: 90_000, contextMaxTokens: null });
  });

  it("of a child's agent counts on the child and on its parent, and once in the project totals", async () => {
    const stats = new Stats();
    await stats.turnEnded("taro", "TR-1", agent, 1_000, { costUsd: 5, contextTokens: null });
    await stats.turnEnded("taro", "TR-1.2", subagent, 1_000, { costUsd: 0.75, contextTokens: null });
    await stats.agentUsage("taro", "TR-1.2", subagent.id, { costUsd: 1, contextTokens: null });
    const summaries = (await stats.all("taro")).map((ticket) => summarize(ticket));
    expect(summaries.find((summary) => summary.ticket === "TR-1.2")).toMatchObject({ agents: 1, costUsd: 1 });
    expect(summaries.find((summary) => summary.ticket === "TR-1")).toMatchObject({ agents: 2, costUsd: 6 });
    expect(projectTotals(summaries)).toMatchObject({ agents: 2, costUsd: 6, agentsWithoutCost: 0 });
  });

  it("is not recorded for an agent the ticket never counted", async () => {
    const stats = new Stats();
    await stats.agentUsage("taro", "TR-1", "stranger", { costUsd: 1, contextTokens: null });
    expect(await stats.all("taro")).toEqual([]);
  });

  describe("backfill", () => {
    async function seed(): Promise<string> {
      const stats = new Stats();
      await stats.turnEnded("taro", "TR-1", agent, 1_000, { costUsd: 4, contextTokens: null });
      await stats.turnEnded("taro", "TR-1.2", subagent, 1_000);
      await stats.turnEnded("taro", "TR-1", { ...subagent, id: "lost" }, 1_000);
      return readFile(join(statsDirectory(), "stats.json"), "utf8");
    }

    it("fills missing costs from where they survive, on child and parent, and leaves recorded ones", async () => {
      await seed();
      const asked: string[] = [];
      const stats = new Stats();
      const backfill = await stats.backfillCosts(async (agentId) => {
        asked.push(agentId);
        return agentId === subagent.id ? 0.9 : null;
      });
      expect(asked.sort()).toEqual(["lost", subagent.id]);
      expect(backfill).toMatchObject({ filled: 1, missing: 1 });
      const file = await statsFile();
      expect(file.tickets["taro:TR-1.2"]?.agents[subagent.id]).toMatchObject({ costUsd: 0.9 });
      expect(file.tickets["taro:TR-1"]?.agents[subagent.id]).toMatchObject({ costUsd: 0.9 });
      expect(file.tickets["taro:TR-1"]?.agents[agent.id]).toMatchObject({ costUsd: 4 });
      expect(file.tickets["taro:TR-1"]?.agents.lost).toMatchObject({ costUsd: null });
      const totals = projectTotals((await stats.all("taro")).map((ticket) => summarize(ticket)));
      expect(totals).toMatchObject({ agents: 3, costUsd: 4.9, agentsWithoutCost: 1 });
    });

    it("saves the file as it was to stats.json.pre-backfill before writing", async () => {
      const original = await seed();
      await new Stats().backfillCosts(async () => 1);
      expect(await readFile(join(statsDirectory(), "stats.json.pre-backfill"), "utf8")).toBe(original);
      expect(await readFile(join(statsDirectory(), "stats.json"), "utf8")).not.toBe(original);
    });

    it("runs once: a second run, even after a reload, asks nothing and changes nothing", async () => {
      const original = await seed();
      await new Stats().backfillCosts(async () => 2);
      const after = await readFile(join(statsDirectory(), "stats.json"), "utf8");
      const lookup = vi.fn(async () => 3);
      expect(await new Stats().backfillCosts(lookup)).toBeNull();
      expect(lookup).not.toHaveBeenCalled();
      expect(await readFile(join(statsDirectory(), "stats.json"), "utf8")).toBe(after);
      expect(await readFile(join(statsDirectory(), "stats.json.pre-backfill"), "utf8")).toBe(original);
    });

    it("never overwrites a cost a turn end recorded while it looked costs up", async () => {
      await seed();
      const stats = new Stats();
      await stats.backfillCosts(async (agentId) => {
        if (agentId === subagent.id) await stats.turnEnded("taro", "TR-1.2", subagent, 1_000, { costUsd: 1.5, contextTokens: null });
        return 0.2;
      });
      expect((await statsFile()).tickets["taro:TR-1.2"]?.agents[subagent.id]).toMatchObject({ costUsd: 1.5 });
    });

    it("on a file with no costs missing, still marks itself done", async () => {
      const stats = new Stats();
      await stats.turnEnded("taro", "TR-1", agent, 1_000, { costUsd: 1, contextTokens: null });
      expect(await stats.backfillCosts(async () => null)).toMatchObject({ filled: 0, missing: 0 });
      expect(await stats.backfillCosts(async () => null)).toBeNull();
    });
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

describe("repeated statuses (TR-100)", () => {
  const directory = () => join(home, "plugin-data", "taro", "state");
  const transitions = async (ticket: string) => ((await statsFile()) as unknown as { tickets: Record<string, { transitions: { to: string; at: string }[] }> }).tickets[`taro:${ticket}`]?.transitions ?? [];

  it("ignores a transition into the status the ticket already has", async () => {
    const stats = new Stats();
    await stats.transition("taro", "TR-1", "One", null, "In Progress", "2026-10-13T10:00:00Z");
    await stats.transition("taro", "TR-1", "One", "In Progress", "Done", "2026-10-13T10:12:00Z");
    await stats.transition("taro", "TR-1", "One", null, "Done", "2026-10-14T17:55:46Z");
    expect((await transitions("TR-1")).map((transition) => transition.at)).toEqual(["2026-10-13T10:00:00Z", "2026-10-13T10:12:00Z"]);
    expect(summarize((await stats.all("taro"))[0]!).wallMs).toBe(12 * 60_000);
  });

  it("gives each recorded ticket's last status, and null for a project with none", async () => {
    const stats = new Stats();
    await stats.transition("taro", "TR-1", "One", null, "Done", "2026-10-13T10:00:00Z");
    await stats.transition("taro", "TR-2", "Two", null, "Queued", "2026-10-13T10:00:00Z");
    expect(await stats.recordedStatuses("taro")).toEqual(new Map([["TR-1", "Done"], ["TR-2", "Queued"]]));
    expect(await stats.recordedStatuses("other")).toBeNull();
  });

  async function seedRepeats(): Promise<string> {
    const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
    const entry = (from: string | null, to: string, minutes: number) => ({ from, to, at: at(minutes) });
    const file = {
      tickets: {
        "taro:TR-1": { project: "taro", ticket: "TR-1", transitions: [entry(null, "Queued", 0), entry("Queued", "Done", 12), entry(null, "Done", 1_800)] },
        "taro:TR-2": { project: "taro", ticket: "TR-2", transitions: [entry(null, "Queued", 0), entry(null, "Queued", 5), entry("Queued", "Awaiting acceptance", 10), entry("Awaiting acceptance", "Done", 20), entry("Awaiting acceptance", "Done", 30)] },
        "taro:TR-3": { project: "taro", ticket: "TR-3", transitions: [entry(null, "Queued", 0), entry("Queued", "Done", 3)] },
      },
      costBackfill: { at: at(0), filled: 0, missing: 0 },
    };
    await mkdir(directory(), { recursive: true });
    const text = JSON.stringify(file);
    await writeFile(join(directory(), "stats.json"), text);
    return text;
  }

  it("repairs the file once: drops every repeat, keeps a backup, and reports the count", async () => {
    const original = await seedRepeats();
    const repair = await new Stats().repairRepeats();
    expect(repair).toEqual({ at: new Date(start).toISOString(), removed: 3 });
    expect((await transitions("TR-1")).map((transition) => transition.to)).toEqual(["Queued", "Done"]);
    expect((await transitions("TR-2")).map((transition) => transition.to)).toEqual(["Queued", "Awaiting acceptance", "Done"]);
    expect(await transitions("TR-3")).toHaveLength(2);
    expect(await readFile(join(directory(), "stats.json.pre-repair"), "utf8")).toBe(original);
    // What TR-097 recorded stays.
    expect((await statsFile()) as unknown).toMatchObject({ costBackfill: { filled: 0, missing: 0 }, repeatRepair: { removed: 3 } });
    const summaries = (await new Stats().all("taro")).map((ticket) => summarize(ticket));
    expect(summaries.find((summary) => summary.ticket === "TR-1")?.wallMs).toBe(12 * 60_000);
  });

  it("is idempotent: a second run, even after a reload, changes nothing and keeps the first backup", async () => {
    const original = await seedRepeats();
    await new Stats().repairRepeats();
    const after = await readFile(join(directory(), "stats.json"), "utf8");
    expect(await new Stats().repairRepeats()).toBeNull();
    expect(await readFile(join(directory(), "stats.json"), "utf8")).toBe(after);
    expect(await readFile(join(directory(), "stats.json.pre-repair"), "utf8")).toBe(original);
  });

  it("on a file without repeats, or with none at all, removes 0 and marks itself done", async () => {
    expect(await new Stats().repairRepeats()).toMatchObject({ removed: 0 });
    expect(await new Stats().repairRepeats()).toBeNull();
  });
});

describe("waiting on the user (TR-100)", () => {
  const waiting = async (ticket: string) => ((await statsFile()) as unknown as { tickets: Record<string, { waiting: { start: string; end: string }[] }> }).tickets[`taro:${ticket}`]?.waiting;
  const iso = (offset: number) => new Date(start + offset).toISOString();

  it("continues a stretch while the checks keep finding the card, and starts another after a gap", async () => {
    const stats = new Stats();
    await stats.waitingSeen("taro", ["TR-1"], start);
    await stats.waitingSeen("taro", ["TR-1"], start + 15_000);
    await stats.waitingSeen("taro", ["TR-1"], start + 30_000);
    // Answered, then waiting again ten minutes later (or the plugin was down).
    await stats.waitingSeen("taro", ["TR-1"], start + 10 * 60_000);
    expect((await stats.all("taro"))[0]?.waiting).toEqual([
      { start: iso(0), end: iso(30_000) },
      { start: iso(10 * 60_000), end: iso(10 * 60_000) },
    ]);
  });

  it("counts a child's waiting on its parent once, when both wait", async () => {
    const stats = new Stats();
    await stats.waitingSeen("taro", ["TR-1.2", "TR-1"], start);
    await stats.waitingSeen("taro", ["TR-1.2"], start + 60_000);
    expect(await waiting("TR-1.2")).toEqual([{ start: iso(0), end: iso(60_000) }]);
    expect(await waiting("TR-1")).toEqual([{ start: iso(0), end: iso(60_000) }]);
  });

  it("starts a new stretch, keeping the old one, when the clock moved back", async () => {
    const stats = new Stats();
    await stats.waitingSeen("taro", ["TR-1"], start + 60_000);
    await stats.waitingSeen("taro", ["TR-1"], start + 30_000);
    expect(await waiting("TR-1")).toEqual([
      { start: iso(60_000), end: iso(60_000) },
      { start: iso(30_000), end: iso(30_000) },
    ]);
  });

  it("writes a continued stretch at most once a minute, and keeps the latest end in memory", async () => {
    const stats = new Stats();
    await stats.waitingSeen("taro", ["TR-1"], start);
    await stats.waitingSeen("taro", ["TR-1"], start + 15_000);
    expect(await waiting("TR-1")).toEqual([{ start: iso(0), end: iso(0) }]);
    expect((await stats.all("taro"))[0]?.waiting).toEqual([{ start: iso(0), end: iso(15_000) }]);
    for (let offset = 30_000; offset <= 60_000; offset += 15_000) await stats.waitingSeen("taro", ["TR-1"], start + offset);
    expect(await waiting("TR-1")).toEqual([{ start: iso(0), end: iso(60_000) }]);
  });

  it("loses nothing when waiting, a transition and the repair run at once", async () => {
    const stats = new Stats();
    await stats.transition("taro", "TR-1", "One", null, "Planning", iso(0));
    await Promise.all([
      stats.waitingSeen("taro", ["TR-1", "TR-2"], start + 1_000),
      stats.transition("taro", "TR-1", "One", "Planning", "Planning", iso(500)),
      stats.repairRepeats(),
      stats.transition("taro", "TR-2", "Two", null, "Blocked", iso(800)),
      stats.turnEnded("taro", "TR-1", agent, 2_000),
    ]);
    const file = (await statsFile()) as unknown as { tickets: Record<string, { transitions: { to: string }[]; waiting: unknown[]; agents: Record<string, unknown> }>; repeatRepair: { removed: number } };
    expect(file.tickets["taro:TR-1"]?.transitions.map((transition) => transition.to)).toEqual(["Planning"]);
    expect(file.tickets["taro:TR-1"]?.waiting).toHaveLength(1);
    expect(file.tickets["taro:TR-1"]?.agents[agent.id]).toMatchObject({ turns: 1, activeMs: 2_000 });
    expect(file.tickets["taro:TR-2"]?.transitions.map((transition) => transition.to)).toEqual(["Blocked"]);
    expect(file.tickets["taro:TR-2"]?.waiting).toHaveLength(1);
    expect(file.repeatRepair.removed).toBe(0);
  });

  it("writes nothing when no card waits", async () => {
    await new Stats().waitingSeen("taro", [], start);
    await expect(statsFile()).rejects.toThrow();
  });

  it("shows in Waiting on you, merged with Awaiting acceptance", async () => {
    const stats = new Stats();
    await stats.transition("taro", "TR-1", "One", null, "Planning", iso(0));
    // A scope approval waits from minute 1 to minute 3, seen by the 15-second checks.
    for (let offset = 60_000; offset <= 3 * 60_000; offset += 15_000) await stats.waitingSeen("taro", ["TR-1"], start + offset);
    await stats.transition("taro", "TR-1", "One", "Planning", "Awaiting acceptance", iso(10 * 60_000));
    for (let offset = 10 * 60_000; offset <= 20 * 60_000; offset += 15_000) await stats.waitingSeen("taro", ["TR-1"], start + offset);
    await stats.transition("taro", "TR-1", "One", "Awaiting acceptance", "Done", iso(20 * 60_000));
    const [summary] = (await stats.all("taro")).map((ticket) => summarize(ticket));
    // 2 minutes on the approval plus 10 in Awaiting acceptance, which the checks also saw: counted once.
    expect(summary?.waitingOnUserMs).toBe(12 * 60_000);
  });
});

describe("starting context (TR-139)", () => {
  it("is taken once per agent, on a child's parent too, and only for an agent already recorded", async () => {
    const stats = new Stats();
    expect(await stats.startingContext("taro", "TR-1.2", agent.id, 18_000)).toBe(false);
    await stats.turnEnded("taro", "TR-1.2", agent, 1_000);
    expect(await stats.hasStartingContext("taro", "TR-1.2", agent.id)).toBe(false);
    expect(await stats.startingContext("taro", "TR-1.2", agent.id, 18_000)).toBe(true);
    expect(await stats.startingContext("taro", "TR-1.2", agent.id, 52_000)).toBe(false);
    expect(await stats.hasStartingContext("taro", "TR-1.2", agent.id)).toBe(true);
    const tickets = (await stats.all("taro")).map((ticket) => [ticket.ticket, ticket.agents[agent.id]?.startingContextTokens]);
    expect(tickets.sort()).toEqual([
      ["TR-1", 18_000],
      ["TR-1.2", 18_000],
    ]);
  });
});
