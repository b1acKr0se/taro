// TR-152: the board reads PR states from gh in the background, cached, a few at a time.
import { describe, expect, it } from "vitest";

import type { CommandResult } from "./process";
import { createPullRequestStates } from "./pull-request-states";

const url = (number: number) => `https://github.com/example/notes-app/pull/${number}`;
const answer = (state: string, isDraft = false): CommandResult => ({ code: 0, stdout: JSON.stringify({ state, isDraft }), stderr: "" });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness() {
  let clock = 1_000_000;
  const calls: string[][] = [];
  const pending: Array<(result: CommandResult) => void> = [];
  const states = createPullRequestStates(
    (command, args) => {
      calls.push([command, ...args]);
      return new Promise((resolve) => pending.push(resolve));
    },
    () => clock,
  );
  return { states, calls, pending, advance: (ms: number) => (clock += ms) };
}

describe("createPullRequestStates", () => {
  it("answers null at once, asks gh once, and gives the state on the next read", async () => {
    const { states, calls, pending } = harness();
    expect(states.current(url(1))).toBeNull();
    expect(states.current(url(1))).toBeNull();
    expect(calls).toEqual([["gh", "pr", "view", url(1), "--json", "state,isDraft"]]);
    pending[0]?.(answer("OPEN", true));
    await settle();
    expect(states.current(url(1))).toBe("draft");
    expect(calls).toHaveLength(1);
  });

  it("asks again about an open PR after a minute, keeping the old state meanwhile", async () => {
    const { states, calls, pending, advance } = harness();
    states.current(url(1));
    pending[0]?.(answer("OPEN", true));
    await settle();
    advance(59_999);
    expect(states.current(url(1))).toBe("draft");
    expect(calls).toHaveLength(1);
    advance(1);
    expect(states.current(url(1))).toBe("draft");
    expect(calls).toHaveLength(2);
    pending[1]?.(answer("OPEN", false));
    await settle();
    expect(states.current(url(1))).toBe("open");
  });

  it("never asks again about a merged PR", async () => {
    const { states, calls, pending, advance } = harness();
    states.current(url(1));
    pending[0]?.(answer("MERGED"));
    await settle();
    advance(365 * 24 * 3_600_000);
    expect(states.current(url(1))).toBe("merged");
    expect(calls).toHaveLength(1);
  });

  it("keeps the last good state when gh fails, and waits five minutes before asking again", async () => {
    const { states, calls, pending, advance } = harness();
    states.current(url(1));
    pending[0]?.(answer("OPEN"));
    await settle();
    advance(60_000);
    states.current(url(1));
    pending[1]?.({ code: 1, stdout: "", stderr: "gh: not logged in" });
    await settle();
    expect(states.current(url(1))).toBe("open");
    advance(299_999);
    states.current(url(1));
    expect(calls).toHaveLength(2);
    advance(1);
    states.current(url(1));
    expect(calls).toHaveLength(3);
  });

  it("treats a thrown run or an unreadable answer as a failure", async () => {
    let clock = 0;
    let calls = 0;
    const states = createPullRequestStates(
      async () => {
        calls++;
        if (calls === 1) throw new Error("spawn gh ENOENT");
        return { code: 0, stdout: "not json", stderr: "" };
      },
      () => clock,
    );
    states.current(url(1));
    await settle();
    expect(states.current(url(1))).toBeNull();
    clock += 300_000;
    states.current(url(1));
    await settle();
    expect(states.current(url(1))).toBeNull();
    expect(calls).toBe(2);
  });

  it("runs at most three gh calls at a time, then the rest in turn", async () => {
    const { states, calls, pending } = harness();
    for (const number of [1, 2, 3, 4, 5]) states.current(url(number));
    expect(calls.map((call) => call[3])).toEqual([url(1), url(2), url(3)]);
    pending[0]?.(answer("OPEN"));
    await settle();
    expect(calls.map((call) => call[3])).toEqual([url(1), url(2), url(3), url(4)]);
    pending[1]?.(answer("OPEN"));
    pending[2]?.(answer("OPEN"));
    await settle();
    expect(calls).toHaveLength(5);
  });
});
