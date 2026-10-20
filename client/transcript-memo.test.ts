import { describe, expect, it } from "vitest";

import { sameGroup, sameItems } from "./transcript-memo";
import type { Group } from "./tool-runs";

const message = (key: string, text: string): Group => ({ key, row: { key, kind: "agent", text } });
const tools = (key: string, ...states: ["running" | "completed" | "failed", string][]): Group => ({
  key,
  tools: states.map(([status, text], index) => ({ key: `${key}-${index}`, kind: "tool" as const, text, label: "Shell", summary: text, icon: "SquareTerminal", tally: { kind: "command" as const }, alone: false, status })),
});

describe("sameGroup", () => {
  it("treats a re-read of the same message as unchanged although the objects are new", () => {
    expect(sameGroup(message("m1", "Plan written."), message("m1", "Plan written."))).toBe(true);
  });

  it("redraws a message whose words grew while streaming", () => {
    expect(sameGroup(message("m1", "Plan"), message("m1", "Plan written."))).toBe(false);
  });

  it("redraws a message whose question line came or went while the words stayed (TR-144)", () => {
    const asking: Group = { key: "m1", row: { key: "m1", kind: "agent", text: "Plan written.", asking: true } };
    expect(sameGroup(message("m1", "Plan written."), asking)).toBe(false);
    expect(sameGroup(asking, { key: "m1", row: { key: "m1", kind: "agent", text: "Plan written.", asking: true } })).toBe(true);
  });

  it("redraws a message when its turn footer came, went or changed (TR-202)", () => {
    const footed = (durationMs: number): Group => ({ key: "m1", row: { key: "m1", kind: "agent", text: "Done.", turn: { copyText: "Done.", completedAt: "2026-10-20T10:00:11Z", durationMs, newest: false } } });
    expect(sameGroup(message("m1", "Done."), footed(11_000))).toBe(false);
    expect(sameGroup(footed(11_000), footed(11_000))).toBe(true);
    expect(sameGroup(footed(11_000), footed(12_000))).toBe(false);
  });

  it("redraws a row that became another kind or another row", () => {
    expect(sameGroup(message("m1", "x"), { key: "m1", row: { key: "m1", kind: "error", text: "x" } })).toBe(false);
    expect(sameGroup(message("m1", "x"), message("m2", "x"))).toBe(false);
  });

  it("redraws a tool run when a tool finishes, fails or another joins it", () => {
    const running = tools("t1", ["running", "Shell npm test"]);
    expect(sameGroup(running, tools("t1", ["running", "Shell npm test"]))).toBe(true);
    expect(sameGroup(running, tools("t1", ["completed", "Shell npm test"]))).toBe(false);
    expect(sameGroup(running, tools("t1", ["failed", "Shell npm test"]))).toBe(false);
    expect(sameGroup(running, tools("t1", ["running", "Shell npm test"], ["running", "Shell git status"]))).toBe(false);
  });

  it("never matches a message with a tool run of the same key", () => {
    expect(sameGroup(message("t1", "x"), tools("t1", ["running", "x"]))).toBe(false);
    expect(sameGroup(tools("t1"), tools("t1"))).toBe(true);
  });
});

describe("sameItems", () => {
  const first = { key: "a" };
  const second = { key: "b" };

  it("matches the same items in a new list, and two missing lists", () => {
    expect(sameItems([first, second], [first, second])).toBe(true);
    expect(sameItems(undefined, undefined)).toBe(true);
    expect(sameItems([], [])).toBe(true);
  });

  it("tells a list from a missing one, another length, order or item", () => {
    expect(sameItems([first], undefined)).toBe(false);
    expect(sameItems([first], [first, second])).toBe(false);
    expect(sameItems([first, second], [second, first])).toBe(false);
    expect(sameItems([first], [{ key: "a" }])).toBe(false);
  });

  it("compares with the given test", () => {
    expect(sameItems([{ path: "/home/user/a.png" }], [{ path: "/home/user/a.png" }], (a, b) => a.path === b.path)).toBe(true);
  });
});
