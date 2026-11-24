import { describe, expect, it } from "vitest";

import { emptyToolTimes, MAX_CALLS_PER_AGENT, MAX_READ_GAP_MS, recordCalls, TOOL_POLL_MS, type AgentToolTimes } from "./tool-times";

const T0 = Date.parse("2026-11-24T10:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
const call = (callId: string, status: string, ms: number) => ({ timestamp: at(ms), item: { type: "tool_call", callId, status } });

describe("recordCalls", () => {
  it("takes a running call's stamp as its start and the finished stamp as its end", () => {
    const first = recordCalls(emptyToolTimes(), [call("a", "running", 1_000)], T0 + 3_000);
    expect(first.calls.a).toEqual({ startedAt: T0 + 1_000 });
    const second = recordCalls(first, [call("a", "completed", 21_000)], T0 + 23_000);
    expect(second.calls.a).toEqual({ startedAt: T0 + 1_000, endedAt: T0 + 21_000 });
  });

  it("bounds a call first seen finished by the time since the previous read", () => {
    const first = recordCalls(emptyToolTimes(), [], T0);
    const second = recordCalls(first, [call("quick", "completed", 3_000)], T0 + TOOL_POLL_MS);
    expect(second.calls.quick).toEqual({ endedAt: T0 + 3_000, underMs: 3_000 });
  });

  it("claims no bound after a long gap or with no earlier read", () => {
    expect(recordCalls(emptyToolTimes(), [call("a", "completed", 1_000)], T0 + 2_000).calls.a).toEqual({ endedAt: T0 + 1_000 });
    const old: AgentToolTimes = { lastReadAt: T0, calls: {} };
    expect(recordCalls(old, [call("a", "failed", MAX_READ_GAP_MS + 500)], T0 + MAX_READ_GAP_MS + 1_000).calls.a).toEqual({ endedAt: T0 + MAX_READ_GAP_MS + 500 });
  });

  it("never revises a call already finished, and keeps the same calls object when nothing changed", () => {
    const first = recordCalls({ lastReadAt: T0, calls: {} }, [call("a", "completed", 1_000)], T0 + 2_000);
    const again = recordCalls(first, [call("a", "completed", 1_000), { timestamp: at(0), item: { type: "assistant_message" } }], T0 + 4_000);
    expect(again.calls).toBe(first.calls);
    expect(again.lastReadAt).toBe(T0 + 4_000);
  });

  it("ignores calls with no id or a status that is not running or finished", () => {
    const result = recordCalls({ lastReadAt: T0, calls: {} }, [{ timestamp: at(1), item: { type: "tool_call", status: "running" } }, call("x", "canceled", 2)], T0 + 100);
    expect(result.calls).toEqual({});
  });

  it("keeps the newest calls only", () => {
    const entries = Array.from({ length: MAX_CALLS_PER_AGENT + 5 }, (_, index) => call(`c${index}`, "completed", index));
    const result = recordCalls({ lastReadAt: T0, calls: {} }, entries, T0 + 5_000_000);
    expect(Object.keys(result.calls)).toHaveLength(MAX_CALLS_PER_AGENT);
    expect(result.calls.c0).toBeUndefined();
    expect(result.calls[`c${MAX_CALLS_PER_AGENT + 4}`]).toBeDefined();
  });
});
