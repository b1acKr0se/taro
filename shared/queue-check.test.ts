import { describe, expect, it } from "vitest";

import {
  MANAGER_HUNG_AFTER_MS,
  MANAGER_IDLE_BEFORE_WAKE_MS,
  emptyQueueWatch,
  holdReason,
  managerCondition,
  markRestarted,
  markWoken,
  newlyAlerted,
  newlyQueuedStartable,
  queuedAlertTicket,
  queuedAlerts,
  queuedTickets,
  recount,
  recountFields,
  restartDue,
  restartLimited,
  shouldWakeIdleManager,
  situationKey,
  trackQueue,
  unmetDependencies,
  type QueueWatch,
  type QueuedTicket,
  type Recount,
} from "./queue-check";

const ticket = (id: string, status: string, parentTaskId: string | null = null) => ({ id, status, parentTaskId });
const owner = (ticketId: string, status = "idle") => ({ status, labels: { "taro.role": "owner", "taro.ticket": ticketId } });
const queued = (id: string, dependencies: string[] = [], notes: string | null = null): QueuedTicket => ({ id, dependencies, notes });

describe("holdReason", () => {
  it("reads the reason of the newest HOLD record", () => {
    expect(holdReason("HOLD 2026-10-14T10:00Z — exclusive rewrite TR-053 first")).toBe("exclusive rewrite TR-053 first");
  });

  it("accepts the other separators and a record spanning lines", () => {
    expect(holdReason("HOLD 2026-10-14T10:00Z -- waits for\nthe release branch")).toBe("waits for the release branch");
    expect(holdReason("HOLD 2026-10-14T10:00Z - the user asked")).toBe("the user asked");
  });

  it("keeps a dash inside the reason", () => {
    expect(holdReason("HOLD 2026-10-14T10:00Z — notes-app first - then this")).toBe("notes-app first - then this");
  });

  it("is lifted by a later RELEASE and renewed by a later HOLD", () => {
    expect(holdReason("HOLD 2026-10-14T10:00Z — rewrite first\nRELEASE 2026-10-14T11:00Z — rewrite merged")).toBeNull();
    expect(holdReason("HOLD 2026-10-14T10:00Z — a\nRELEASE 2026-10-14T11:00Z — b\nHOLD 2026-10-14T12:00Z — c")).toBe("c");
  });

  it("is null without notes or without a HOLD, and ignores the word inside other records", () => {
    expect(holdReason(null)).toBeNull();
    expect(holdReason("")).toBeNull();
    expect(holdReason("DISPATCH-INTENT 2026-10-14T10:00Z — HOLD on, token x\nMILESTONE 2026-10-14T10:05Z — done")).toBeNull();
    expect(holdReason("HOLDING 2026-10-14T10:00Z — not a record name")).toBeNull();
  });

  it("names a HOLD without a reason", () => {
    expect(holdReason("HOLD")).toBe("no reason given");
  });
});

describe("unmetDependencies", () => {
  const tickets = [ticket("TR-1", "Done"), ticket("TR-2", "In Progress"), ticket("TR-3", "Cancelled")];

  it("lists dependencies whose ticket is not Done, case-insensitively", () => {
    expect(unmetDependencies(["TR-1", "tr-2", "TR-3"], tickets)).toEqual(["tr-2", "TR-3"]);
  });

  it("ignores a dependency the tracker does not list", () => {
    expect(unmetDependencies(["TR-99"], tickets)).toEqual([]);
  });

  it("is empty with no dependencies", () => {
    expect(unmetDependencies([], tickets)).toEqual([]);
  });
});

describe("queuedTickets", () => {
  it("keeps top-level Backlog tickets in order", () => {
    const tickets = [ticket("TR-1", "Backlog"), ticket("TR-2", "Backlog", "TR-1"), ticket("TR-3", "Planning"), ticket("TR-4", "Backlog")];
    expect(queuedTickets(tickets).map((entry) => entry.id)).toEqual(["TR-1", "TR-4"]);
  });
});

describe("recount", () => {
  const tickets = [ticket("TR-1", "In Progress"), ticket("TR-2", "Awaiting acceptance"), ticket("TR-5", "Backlog"), ticket("TR-6", "Backlog"), ticket("TR-7", "Backlog"), ticket("TR-8", "Backlog")];

  it("splits the queue into startable, waiting and held, oldest first", () => {
    const count = recount({
      owners: [owner("TR-1"), owner("TR-2")],
      tickets,
      queued: [queued("TR-5"), queued("TR-6", ["TR-1"]), queued("TR-7", [], "HOLD 2026-10-14T10:00Z — exclusive rewrite TR-1 first"), queued("TR-8")],
      cap: 3,
      threads: { current: 800, max: 2048 },
    });
    expect(count).toEqual({
      counting: ["TR-1"],
      cap: 3,
      threads: { current: 800, max: 2048 },
      freeSlot: true,
      startable: ["TR-5", "TR-8"],
      waiting: [{ id: "TR-6", on: ["TR-1"] }],
      held: [{ id: "TR-7", reason: "exclusive rewrite TR-1 first" }],
    });
  });

  it("has no free slot at the cap", () => {
    expect(recount({ owners: [owner("TR-1")], tickets, queued: [], cap: 1, threads: null }).freeSlot).toBe(false);
  });

  it("has no free slot over the cap (an owner sent back to work)", () => {
    const busy = [ticket("TR-1", "In Progress"), ticket("TR-2", "In Progress")];
    expect(recount({ owners: [owner("TR-1"), owner("TR-2")], tickets: busy, queued: [], cap: 1, threads: null }).freeSlot).toBe(false);
  });

  it("has no free slot while threads are above 85%", () => {
    expect(recount({ owners: [], tickets, queued: [], cap: 3, threads: { current: 1800, max: 2048 } }).freeSlot).toBe(false);
    expect(recount({ owners: [], tickets, queued: [], cap: 3, threads: { current: 1740, max: 2048 } }).freeSlot).toBe(true);
  });

  it("has no free slot with a cap of zero", () => {
    expect(recount({ owners: [], tickets, queued: [], cap: 0, threads: null }).freeSlot).toBe(false);
  });
});

const count = (overrides: Partial<Recount> = {}): Recount => ({ counting: ["TR-1"], cap: 3, threads: null, freeSlot: true, startable: ["TR-5"], waiting: [], held: [], ...overrides });

describe("shouldWakeIdleManager", () => {
  const now = 10 * 60 * 60_000;
  const idle = { managerMidTurn: false, lastTurnEndedAt: now - MANAGER_IDLE_BEFORE_WAKE_MS, lastWokenFor: null, now };

  it("wakes an idle Manager when a ticket could start", () => {
    expect(shouldWakeIdleManager({ ...idle, count: count() })).toBe(true);
  });

  it("waits until the Manager has been idle for two minutes", () => {
    expect(shouldWakeIdleManager({ ...idle, lastTurnEndedAt: now - MANAGER_IDLE_BEFORE_WAKE_MS + 1, count: count() })).toBe(false);
  });

  it("leaves a Manager mid-turn, or one with no known turn end", () => {
    expect(shouldWakeIdleManager({ ...idle, managerMidTurn: true, count: count() })).toBe(false);
    expect(shouldWakeIdleManager({ ...idle, lastTurnEndedAt: null, count: count() })).toBe(false);
  });

  it("does nothing without a free slot or a startable ticket", () => {
    expect(shouldWakeIdleManager({ ...idle, count: count({ freeSlot: false }) })).toBe(false);
    expect(shouldWakeIdleManager({ ...idle, count: count({ startable: [] }) })).toBe(false);
  });

  it("does not wake for a held ticket alone", () => {
    expect(shouldWakeIdleManager({ ...idle, count: count({ startable: [], held: [{ id: "TR-5", reason: "rewrite first" }] }) })).toBe(false);
  });

  it("wakes once per situation, and again when it changes", () => {
    const first = count();
    expect(shouldWakeIdleManager({ ...idle, count: first, lastWokenFor: situationKey(first) })).toBe(false);
    expect(shouldWakeIdleManager({ ...idle, count: count({ startable: ["TR-5", "TR-6"] }), lastWokenFor: situationKey(first) })).toBe(true);
    expect(shouldWakeIdleManager({ ...idle, count: count({ counting: [] }), lastWokenFor: situationKey(first) })).toBe(true);
  });
});

describe("newlyQueuedStartable", () => {
  it("names startable tickets the last look did not know", () => {
    expect(newlyQueuedStartable(new Map([["TR-1", "In Progress"]]), count({ startable: ["TR-1", "TR-5"] }))).toEqual(["TR-5"]);
  });

  it("names none without a free slot or without a last look", () => {
    expect(newlyQueuedStartable(new Map(), count({ freeSlot: false }))).toEqual([]);
    expect(newlyQueuedStartable(null, count())).toEqual([]);
  });

  it("names none for a ticket already known in Backlog", () => {
    expect(newlyQueuedStartable(new Map([["TR-5", "Backlog"]]), count())).toEqual([]);
  });
});

describe("the escalation ladder", () => {
  const start = 1_000_000;
  const minutes = (n: number) => start + n * 60_000;

  function watched(overrides: Partial<Recount> = {}): QueueWatch {
    const watch = emptyQueueWatch();
    trackQueue(watch, count(overrides), start);
    return watch;
  }

  it("keeps when each startable ticket was first seen, and drops one that started", () => {
    const watch = watched({ startable: ["TR-5", "TR-6"] });
    trackQueue(watch, count({ startable: ["TR-6", "TR-7"] }), minutes(1));
    expect([...watch.queuedAt]).toEqual([
      ["TR-6", start],
      ["TR-7", minutes(1)],
    ]);
  });

  it("drops every ticket, with its wake-up and dismissal, once the slots fill", () => {
    const watch = watched();
    markWoken(watch, count(), start);
    watch.dismissed.add("TR-5");
    trackQueue(watch, count({ freeSlot: false }), minutes(1));
    expect(watch.queuedAt.size + watch.wokenAt.size + watch.dismissed.size).toBe(0);
  });

  it("drops a ticket that the Manager holds", () => {
    const watch = watched();
    trackQueue(watch, count({ startable: [], held: [{ id: "TR-5", reason: "rewrite first" }] }), minutes(1));
    expect(watch.queuedAt.size).toBe(0);
  });

  it("names a ticket as newly woken only once", () => {
    const watch = watched();
    expect(markWoken(watch, count(), minutes(1))).toEqual(["TR-5"]);
    expect(markWoken(watch, count({ startable: ["TR-5", "TR-6"] }), minutes(2))).toEqual(["TR-6"]);
    expect(watch.wokenAt.get("TR-5")).toBe(minutes(1));
    expect(watch.wokenFor).toBe(situationKey(count({ startable: ["TR-5", "TR-6"] })));
  });

  it("raises the alert ten minutes after the wake-up, not before", () => {
    const watch = watched();
    markWoken(watch, count(), minutes(2));
    expect(queuedAlerts(watch, minutes(11))).toEqual([]);
    expect(queuedAlerts(watch, minutes(12))).toEqual([
      {
        id: "queued-free-slot:TR-5",
        text: "TR-5 queued with a free slot: the plugin told the Manager 10 minutes ago, and it has not dispatched it. Open the Manager's tab to see why, or ask it to dispatch TR-5. Unless you dismiss this or tell the Manager something, the plugin restarts the Manager 20 minutes after it was told.",
      },
    ]);
    expect(queuedAlertTicket("queued-free-slot:TR-5")).toBe("TR-5");
    expect(queuedAlertTicket("headroom")).toBeNull();
  });

  it("raises the alert ten minutes after the first look when the Manager could never be woken", () => {
    const watch = watched();
    expect(queuedAlerts(watch, minutes(10))[0]?.text).toContain("the Manager has been busy for 10 minutes and could not be told");
  });

  it("logs an alert once, and again only after the ticket left the ladder and came back", () => {
    const watch = watched();
    expect(newlyAlerted(watch, minutes(10))).toEqual(["TR-5"]);
    expect(newlyAlerted(watch, minutes(11))).toEqual([]);
    trackQueue(watch, count({ startable: [] }), minutes(12));
    trackQueue(watch, count(), minutes(13));
    expect(newlyAlerted(watch, minutes(23))).toEqual(["TR-5"]);
  });

  it("takes a dismissed alert down", () => {
    const watch = watched();
    watch.dismissed.add("TR-5");
    expect(queuedAlerts(watch, minutes(30))).toEqual([]);
  });

  describe("the restart", () => {
    function woken(): QueueWatch {
      const watch = watched();
      markWoken(watch, count(), start);
      return watch;
    }

    it("is due twenty minutes after the wake-up for an idle Manager", () => {
      expect(restartDue(woken(), count(), "idle", minutes(20) - 1)).toEqual([]);
      expect(restartDue(woken(), count(), "idle", minutes(20))).toEqual(["TR-5"]);
    });

    it("is due for an unresponsive Manager", () => {
      expect(restartDue(woken(), count(), "unresponsive", minutes(20))).toEqual(["TR-5"]);
    });

    it("never touches a busy or missing Manager", () => {
      expect(restartDue(woken(), count(), "busy", minutes(40))).toEqual([]);
      expect(restartDue(woken(), count(), "missing", minutes(40))).toEqual([]);
    });

    it("never restarts for a held ticket", () => {
      const watch = woken();
      const held = count({ startable: [], held: [{ id: "TR-5", reason: "exclusive rewrite TR-1 first" }] });
      expect(restartDue(watch, held, "idle", minutes(25))).toEqual([]);
      trackQueue(watch, held, minutes(25));
      expect(restartDue(watch, count(), "idle", minutes(26))).toEqual([]);
    });

    it("never restarts while threads are near the limit or the slots are full", () => {
      expect(restartDue(woken(), count({ freeSlot: false }), "idle", minutes(25))).toEqual([]);
    });

    it("is stopped by dismissing the alert", () => {
      const watch = woken();
      watch.dismissed.add("TR-5");
      expect(restartDue(watch, count(), "idle", minutes(25))).toEqual([]);
    });

    it("is stopped by the user telling the Manager something after the alert, not before", () => {
      const before = woken();
      before.userToldManagerAt = minutes(9);
      expect(restartDue(before, count(), "idle", minutes(25))).toEqual(["TR-5"]);
      const after = woken();
      after.userToldManagerAt = minutes(10);
      expect(restartDue(after, count(), "idle", minutes(25))).toEqual([]);
    });

    it("is stopped by a Manager turn that ended after the alert went up, not one before", () => {
      expect(restartDue(woken(), count(), "idle", minutes(25), minutes(9))).toEqual(["TR-5"]);
      expect(restartDue(woken(), count(), "idle", minutes(25), minutes(10))).toEqual([]);
    });

    it("happens at most once an hour per project, and the alert then says so", () => {
      const watch = woken();
      markRestarted(watch, ["TR-5"], minutes(20), true);
      expect(watch.wokenAt.get("TR-5")).toBe(minutes(20));
      expect(watch.wokenFor).toBeNull();
      expect(restartDue(watch, count(), "idle", minutes(79))).toEqual([]);
      expect(restartLimited(watch, minutes(79))).toBe(true);
      expect(queuedAlerts(watch, minutes(79))[0]?.text).toContain("already restarted the Manager within the hour, so it leaves this to you");
      expect(restartDue(watch, count(), "idle", minutes(80))).toEqual(["TR-5"]);
    });

    it("counts a failed restart for the hourly limit and leaves the alert up", () => {
      const watch = woken();
      markRestarted(watch, ["TR-5"], minutes(20), false);
      expect(watch.wokenAt.get("TR-5")).toBe(start);
      expect(queuedAlerts(watch, minutes(21))).toHaveLength(1);
      expect(restartDue(watch, count(), "idle", minutes(21))).toEqual([]);
    });
  });
});

describe("managerCondition", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

  it("is idle between turns", () => {
    expect(managerCondition({ status: "idle", updatedAt: at(1), stalled: false }, now)).toBe("idle");
  });

  it("is busy mid-turn, and unresponsive once the turn shows no activity for half an hour", () => {
    expect(managerCondition({ status: "running", updatedAt: at(29), stalled: false }, now)).toBe("busy");
    expect(managerCondition({ status: "running", updatedAt: at(MANAGER_HUNG_AFTER_MS / 60_000), stalled: false }, now)).toBe("unresponsive");
    expect(managerCondition({ status: "initializing", updatedAt: at(5), stalled: false }, now)).toBe("busy");
  });

  it("leaves a crashed Manager to crash recovery until recovery gave up", () => {
    expect(managerCondition({ status: "error", updatedAt: at(40), stalled: false }, now)).toBe("busy");
    expect(managerCondition({ status: "error", updatedAt: at(40), stalled: true }, now)).toBe("unresponsive");
  });

  it("is missing when archived, closed or unknown", () => {
    expect(managerCondition(null, now)).toBe("missing");
    expect(managerCondition({ status: "closed", updatedAt: at(1), stalled: false }, now)).toBe("missing");
  });
});

describe("recountFields", () => {
  it("spells the recount out for a message", () => {
    expect(
      recountFields(count({ threads: { current: 820, max: 2048 }, waiting: [{ id: "TR-6", on: ["TR-1", "TR-2"] }], held: [{ id: "TR-7", reason: "rewrite first" }] })),
    ).toEqual({
      counting: "1",
      cap: "3",
      countingTickets: "TR-1",
      freeSlots: "2",
      threads: "820 of 2048 (40%)",
      startable: "TR-5",
      waiting: "TR-6 (on TR-1, TR-2)",
      held: "TR-7 (rewrite first)",
    });
  });

  it("says none and no limit for empty parts, and no negative free slots over the cap", () => {
    expect(recountFields(count({ counting: ["TR-1", "TR-2"], cap: 1, startable: [] }))).toMatchObject({
      countingTickets: "TR-1, TR-2",
      freeSlots: "0",
      threads: "no limit published",
      startable: "none",
      waiting: "none",
      held: "none",
    });
  });
});
