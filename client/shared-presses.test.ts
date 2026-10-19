// TR-191: Accept on the Needs you card left the chat's Accept live until the next poll; a call's surfaces now share one guard.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HOLD_MS, type PressShown } from "./press-guard";
import { acceptanceCall, createSharedPresses, decisionCall, optionPress } from "./shared-presses";

function pending<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const call = acceptanceCall("notes-app", "NA-12");

describe("createSharedPresses", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows one surface's press busy on every surface of the call, and ignores a press from another", async () => {
    const presses = createSharedPresses();
    const card: (PressShown | null)[] = [];
    const chat: (PressShown | null)[] = [];
    presses.subscribe(call, (shown) => card.push(shown));
    presses.subscribe(call, (shown) => chat.push(shown));
    const merge = pending<void>();
    const fromCard = presses.guardFor(call).run("accept", () => merge.promise, "hold");
    const fromChat = vi.fn(async () => undefined);
    expect(presses.guardFor(call).run("accept", fromChat, "hold")).toBeNull();
    expect(presses.guardFor(call).run("request-changes", fromChat)).toBeNull();
    expect(fromChat).not.toHaveBeenCalled();
    expect(chat).toEqual([{ key: "accept", phase: "busy" }]);
    expect(card).toEqual(chat);
    merge.resolve();
    await fromCard;
    // Held after success: the accepted ticket leaves every surface, and nothing may be pressed meanwhile.
    expect(presses.shown(call)).toEqual({ key: "accept", phase: "busy" });
    expect(presses.guardFor(call).run("accept", fromChat, "hold")).toBeNull();
  });

  it("frees every surface when the press fails", async () => {
    const presses = createSharedPresses();
    const chat: (PressShown | null)[] = [];
    presses.subscribe(call, (shown) => chat.push(shown));
    const refused = await presses.guardFor(call).run("accept", () => Promise.reject(new Error("evidence incomplete")), "hold");
    expect(refused).toMatchObject({ ok: false });
    expect(chat).toEqual([{ key: "accept", phase: "busy" }, null]);
    expect(presses.guardFor(call).run("request-changes", async () => undefined)).not.toBeNull();
  });

  it("frees every surface after the hold, should the call not leave", async () => {
    const presses = createSharedPresses();
    const chat: (PressShown | null)[] = [];
    presses.subscribe(call, (shown) => chat.push(shown));
    await presses.guardFor(call).run("accept", async () => undefined, "hold");
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(presses.shown(call)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(presses.shown(call)).toBeNull();
    expect(chat.at(-1)).toBeNull();
  });

  it("keeps a hold after the pressing surface left, for a surface opened meanwhile", async () => {
    const presses = createSharedPresses();
    const leave = presses.subscribe(call, () => undefined);
    await presses.guardFor(call).run("accept", async () => undefined, "hold");
    // The Needs you card goes as the board catches up; the chat opens a moment later.
    leave();
    expect(presses.shown(call)).toEqual({ key: "accept", phase: "busy" });
    expect(presses.guardFor(call).run("accept", async () => undefined, "hold")).toBeNull();
    vi.advanceTimersByTime(HOLD_MS);
    expect(presses.size()).toBe(0);
  });

  it("drops an idle call nobody shows, and keeps one still shown", () => {
    const presses = createSharedPresses();
    const leave = presses.subscribe(call, () => undefined);
    presses.subscribe(decisionCall("owner:scope-approval"), () => undefined);
    expect(presses.size()).toBe(2);
    leave();
    expect(presses.size()).toBe(1);
    expect(presses.shown(call)).toBeNull();
  });

  it("leaves another ticket and a decision of the same ticket alone", () => {
    const presses = createSharedPresses();
    expect(presses.guardFor(call).run("accept", () => new Promise<void>(() => undefined), "hold")).not.toBeNull();
    expect(presses.guardFor(acceptanceCall("notes-app", "NA-13")).run("accept", async () => undefined, "hold")).not.toBeNull();
    expect(presses.guardFor(acceptanceCall("other-app", "NA-12")).run("accept", async () => undefined, "hold")).not.toBeNull();
    expect(presses.guardFor(decisionCall("owner:scope-approval")).run(optionPress("Approve"), async () => undefined, "hold")).not.toBeNull();
  });

  it("gives an option the same press key on every surface, distinct per option", () => {
    expect(optionPress("Approve")).toBe(optionPress("Approve"));
    expect(optionPress("Approve")).not.toBe(optionPress("Split into children"));
    expect(decisionCall("a:scope-approval")).not.toBe(acceptanceCall("a", "scope-approval"));
  });
});
