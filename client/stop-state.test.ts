import { describe, expect, it } from "vitest";

import { isWorking, statusWithTurn, viewSends, type PendingSend } from "../shared/pending-sends";
import { createPendingSendStore } from "./pending-send-store";
import { sendingToQueue, sendsAsIdle } from "./queue-rows";
import { heldSends, STOP_SETTLE_MS, stopHolds, type StopPress } from "./stop-state";

const PRESS: StopPress = { agentId: "ag1", pressedAt: 10_000, turnCountAtPress: 3, answeredAt: null, failed: false };
const WORKING = { agentId: "ag1", working: true, turnCount: 3 };

function send(id: string, at: number, state: PendingSend["state"], sentWhileIdle = true): PendingSend {
  return { id, text: id, attachments: [], at, state, ...(sentWhileIdle ? { sentWhileIdle: true } : {}) };
}

/** The status the chat shows, as `AgentChat` works it out. */
function shownStatus(press: StopPress | null, daemonStatus: string, turnCount: number, now: number): string {
  const before = statusWithTurn(daemonStatus, null);
  return stopHolds(press, { agentId: "ag1", working: isWorking(before), turnCount }, now) ? "idle" : before;
}

describe("stopHolds", () => {
  it("holds nothing without a press", () => {
    expect(stopHolds(null, WORKING, 10_000)).toBe(false);
  });

  it("holds the turn as ended from the press, before the stop answered", () => {
    expect(stopHolds(PRESS, WORKING, 10_000)).toBe(true);
    expect(stopHolds(PRESS, WORKING, 60_000)).toBe(true);
    expect(shownStatus(PRESS, "running", 3, 10_000)).toBe("idle");
  });

  it("holds until the cap after the stop answered, then shows the daemon's status again", () => {
    const answered = { ...PRESS, answeredAt: 11_200 };
    expect(STOP_SETTLE_MS).toBe(4_000);
    expect(stopHolds(answered, WORKING, 11_200 + 3_999)).toBe(true);
    expect(stopHolds(answered, WORKING, 15_199)).toBe(true);
    expect(stopHolds(answered, WORKING, 11_200 + 4_001)).toBe(false);
    expect(shownStatus(answered, "running", 3, 15_201)).toBe("running");
  });

  it("releases on any turn boundary the stream reports after the press, a new start after a start included", () => {
    expect(stopHolds(PRESS, { ...WORKING, turnCount: 4 }, 10_500)).toBe(false);
    // A start counted at the press, then another start (the queue's next turn): still a boundary.
    const afterStart = { ...PRESS, turnCountAtPress: 5 };
    expect(stopHolds(afterStart, { ...WORKING, turnCount: 6 }, 10_500)).toBe(false);
  });

  it("releases when the count went back to 0 as the timeline started over", () => {
    expect(stopHolds(PRESS, { ...WORKING, turnCount: 0 }, 10_500)).toBe(false);
  });

  it("releases once the agent reads as not working", () => {
    expect(stopHolds(PRESS, { ...WORKING, working: false }, 10_500)).toBe(false);
  });

  it("releases on a failed stop, so Stop and the working line come back", () => {
    const failed = { ...PRESS, failed: true };
    expect(stopHolds(failed, WORKING, 10_500)).toBe(false);
    expect(shownStatus(failed, "running", 3, 10_500)).toBe("running");
  });

  it("holds only the agent it was pressed for", () => {
    expect(stopHolds(PRESS, { ...WORKING, agentId: "ag2" }, 10_500)).toBe(false);
  });

  it("sends a message typed during the hold as to an idle agent, unless the queue track has rows", () => {
    const workingShown = isWorking(shownStatus(PRESS, "running", 3, 10_500));
    expect(workingShown).toBe(false);
    expect(sendsAsIdle(workingShown, 0, false)).toBe(true);
    expect(sendsAsIdle(workingShown, 1, false)).toBe(false);
  });
});

describe("heldSends", () => {
  it("lists the queued and sending messages sent after the press as to an idle agent", () => {
    const sends = [send("chat-d", 10_500, "queued"), send("chat-e", 10_700, "sending"), send("chat-f", 10_000, "queued")];
    expect(heldSends(sends, 10_000)).toEqual(["chat-d", "chat-e", "chat-f"]);
  });

  it("leaves out sent, failed and earlier messages", () => {
    const sends = [send("chat-a", 10_500, "sent"), send("chat-b", 10_500, "failed"), send("chat-c", 9_000, "queued"), send("chat-g", 10_500, "queued", false)];
    expect(heldSends(sends, 10_000)).toEqual([]);
    expect(heldSends([], 10_000)).toEqual([]);
  });

  it("moves such a message to the queue track once the store clears its mark", () => {
    const store = createPendingSendStore({});
    store.add("ag1", send("chat-d", 10_500, "queued"));
    const track = () => sendingToQueue(viewSends(store.get("ag1"), [], { stoppedAt: null, hasOlder: false }, 10_600).views).map((row) => row.id);
    expect(track()).toEqual([]);
    heldSends(store.get("ag1"), 10_000).forEach((id) => store.update("ag1", id, { sentWhileIdle: false }));
    expect(store.get("ag1")[0]).toMatchObject({ state: "queued", sentWhileIdle: false });
    expect(track()).toEqual(["chat-d"]);
  });
});
