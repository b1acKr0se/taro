import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PaseoApi } from "./host-types";
import { forgetCallTimes, readAndRecord, readCallTimes, toolTimePollers } from "./tool-times";

let home: string;
const saved = process.env.PASEO_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tool-times."));
  process.env.PASEO_HOME = home;
});
afterEach(async () => {
  if (saved === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = saved;
  vi.useRealTimers();
  await rm(home, { recursive: true, force: true });
});

function fakePaseo(read: () => unknown[]): { paseo: PaseoApi; reads: () => number } {
  let reads = 0;
  const paseo = { agents: { ref: () => ({ timeline: { refetch: async () => (reads++, { entries: read() }) } }) } } as unknown as PaseoApi;
  return { paseo, reads: () => reads };
}
const entry = (callId: string, status: string, timestamp: number) => ({ timestamp: new Date(timestamp).toISOString(), item: { type: "tool_call", callId, status } });

describe("tool call times", () => {
  it("records a call across reads, keeps it for a later reader, and forgets it", async () => {
    const now = Date.now();
    let items = [entry("a", "running", now - 2_000)];
    const { paseo } = fakePaseo(() => items);
    await readAndRecord(paseo, "agent-1", now);
    items = [entry("a", "completed", now + 18_000)];
    await readAndRecord(paseo, "agent-1", now + 20_000);
    expect(await readCallTimes("agent-1")).toEqual({ a: { startedAt: now - 2_000, endedAt: now + 18_000 } });
    await forgetCallTimes("agent-1");
    expect(await readCallTimes("agent-1")).toEqual({});
    expect(await readdir(join(home, "plugin-data", "taro", "tool-times"))).toEqual([]);
  });

  it("bounds a call that ran between two reads even though only the first wrote nothing", async () => {
    const now = Date.now();
    let items: unknown[] = [];
    const { paseo } = fakePaseo(() => items);
    await readAndRecord(paseo, "agent-2", now);
    items = [entry("q", "completed", now + 2_000)];
    await readAndRecord(paseo, "agent-2", now + 5_000);
    expect(await readCallTimes("agent-2")).toEqual({ q: { endedAt: now + 2_000, underMs: 2_000 } });
  });

  it("reads only while a started agent's turn runs", async () => {
    vi.useFakeTimers();
    const { paseo, reads } = fakePaseo(() => []);
    const pollers = toolTimePollers();
    await pollers.finish(paseo, "never-started", () => undefined);
    expect(reads()).toBe(0);
    pollers.start(paseo, "agent-3", () => undefined);
    pollers.start(paseo, "agent-3", () => undefined);
    await vi.advanceTimersByTimeAsync(11_000);
    const during = reads();
    expect(during).toBeGreaterThanOrEqual(2);
    await pollers.finish(paseo, "agent-3", () => undefined);
    const ended = reads();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads()).toBe(ended);
    pollers.stopAll();
  });
});
