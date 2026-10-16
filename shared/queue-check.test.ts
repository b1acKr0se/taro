import { describe, expect, it } from "vitest";

import { parkedUnstartedHoldText, unparkedReleaseText } from "./pause";
import {
  MANAGER_HUNG_AFTER_MS,
  alertRaisedAt,
  MANAGER_IDLE_BEFORE_WAKE_MS,
  emptyQueueWatch,
  holdReason,
  managerCondition,
  markRestarted,
  markWoken,
  newlyAlerted,
  newlyWithheld,
  newlyQueuedStartable,
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
  it("keeps top-level Queued tickets in order", () => {
    const tickets = [ticket("TR-1", "Queued"), ticket("TR-2", "Queued", "TR-1"), ticket("TR-3", "Planning"), ticket("TR-4", "Queued")];
    expect(queuedTickets(tickets).map((entry) => entry.id)).toEqual(["TR-1", "TR-4"]);
  });
});

describe("recount", () => {
  const tickets = [ticket("TR-1", "In Progress"), ticket("TR-2", "Awaiting acceptance"), ticket("TR-5", "Queued"), ticket("TR-6", "Queued"), ticket("TR-7", "Queued"), ticket("TR-8", "Queued")];

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
      owned: [],
    });
  });

  it("counts a queued ticket that already has a live owner, and never calls it startable", () => {
    const paused = recount({ owners: [owner("TR-1"), owner("tr-5")], tickets, queued: [queued("TR-5"), queued("TR-8")], cap: 2, threads: null });
    expect(paused).toMatchObject({ counting: ["TR-1", "TR-5"], freeSlot: false, startable: ["TR-8"], owned: ["TR-5"] });
    const closed = recount({ owners: [owner("TR-5", "closed")], tickets, queued: [queued("TR-5")], cap: 2, threads: null });
    expect(closed).toMatchObject({ counting: [], startable: ["TR-5"], owned: [] });
  });

  it("never calls a ticket the user parked startable, in its old or its TR-166 words, until Resume releases it", () => {
    const parked = parkedUnstartedHoldText("2026-10-14T10:00Z");
    const count = recount({
      owners: [],
      tickets,
      queued: [queued("TR-5", [], parked), queued("TR-6", [], "HOLD 2026-10-14T10:00Z — paused by the user; resume from the latest HANDOFF"), queued("TR-8")],
      cap: 3,
      threads: null,
    });
    expect(count.startable).toEqual(["TR-8"]);
    expect(count.held.map((held) => held.id)).toEqual(["TR-5", "TR-6"]);
    const resumed = recount({ owners: [], tickets, queued: [queued("TR-5", [], `${parked}\n\n${unparkedReleaseText("2026-10-14T11:00Z")}`)], cap: 3, threads: null });
    expect(resumed.startable).toEqual(["TR-5"]);
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

const count = (overrides: Partial<Recount> = {}): Recount => ({ counting: ["TR-1"], cap: 3, threads: null, freeSlot: true, startable: ["TR-5"], waiting: [], held: [], owned: [], ...overrides });

describe("shouldWakeIdleManager", () => {
  const now = 10 * 60 * 60_000;
  const idle = { managerMidTurn: false, lastTurnEndedAt: now - MANAGER_IDLE_BEFORE_WAKE_MS, lastWokenFor: null, now };

  it("wakes an idle manager when a ticket could start", () => {
    expect(shouldWakeIdleManager({ ...idle, count: count() })).toBe(true);
  });

  it("waits until the manager has been idle for two minutes", () => {
    expect(shouldWakeIdleManager({ ...idle, lastTurnEndedAt: now - MANAGER_IDLE_BEFORE_WAKE_MS + 1, count: count() })).toBe(false);
  });

  it("leaves a manager mid-turn, or one with no known turn end", () => {
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

  it("names none for a ticket already known as Queued", () => {
    expect(newlyQueuedStartable(new Map([["TR-5", "Queued"]]), count())).toEqual([]);
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

  it("keeps a dismissal while the ticket stays queued, even with no ladder entry yet (after a reload)", () => {
    const watch = emptyQueueWatch();
    watch.dismissed.add("TR-5");
    trackQueue(watch, count(), start);
    expect(watch.dismissed.has("TR-5")).toBe(true);
    trackQueue(watch, count({ startable: [] }), start + 1);
    expect(watch.dismissed.has("TR-5")).toBe(false);
  });

  it("drops every ticket, with its wake-up and dismissal, once the slots fill", () => {
    const watch = watched();
    markWoken(watch, count(), start);
    watch.dismissed.add("TR-5");
    trackQueue(watch, count({ freeSlot: false }), minutes(1));
    expect(watch.queuedAt.size + watch.wokenAt.size + watch.dismissed.size).toBe(0);
  });

  it("drops a ticket that the manager holds", () => {
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
    expect(queuedAlerts(watch, minutes(11), "busy")).toEqual([]);
    expect(queuedAlerts(watch, minutes(12), "busy")).toEqual([
      {
        id: "queued-free-slot",
        tickets: ["TR-5"],
        text: "TR-5 queued with a free slot: the plugin told the manager 10 minutes ago, and it has not dispatched it. Open the manager's tab to see why, or ask it to dispatch the ticket. Unless you dismiss this or tell the manager something, the plugin restarts the manager 20 minutes after it was told.",
      },
    ]);
  });

  it("raises the alert ten minutes after the first look when the manager could never be woken", () => {
    const watch = watched();
    expect(queuedAlerts(watch, minutes(10), "busy")[0]?.text).toBe(
      "TR-5 queued with a free slot: the manager has been busy for 10 minutes, so the plugin could not tell it yet. It tells the manager once it is idle, and restarts it only if it hangs. Open the manager's tab to see what it is doing.",
    );
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
    expect(queuedAlerts(watch, minutes(30), "busy")).toEqual([]);
  });

  describe("several tickets (TR-064)", () => {
    it("shows one alert naming them all, in ticket order, counting from the longest wait", () => {
      const watch = watched({ startable: ["TR-10", "TR-9", "TR-11"] });
      markWoken(watch, count({ startable: ["TR-10", "TR-9", "TR-11"] }), minutes(1));
      expect(queuedAlerts(watch, minutes(15), "busy")).toEqual([
        {
          id: "queued-free-slot",
          tickets: ["TR-9", "TR-10", "TR-11"],
          text: "TR-9, TR-10 and TR-11 queued with a free slot: the plugin told the manager 14 minutes ago, and it has not dispatched them. Open the manager's tab to see why, or ask it to dispatch the tickets. Unless you dismiss this or tell the manager something, the plugin restarts the manager 20 minutes after it was told.",
        },
      ]);
    });

    it("names two with 'and' and no comma", () => {
      const watch = watched({ startable: ["TR-5", "TR-6"] });
      expect(queuedAlerts(watch, minutes(12), "busy")[0]?.text).toBe(
        "TR-5 and TR-6 queued with a free slot: the manager has been busy for 12 minutes, so the plugin could not tell it yet. It tells the manager once it is idle, and restarts it only if it hangs. Open the manager's tab to see what it is doing.",
      );
    });

    it("says which tickets the manager was told about and which not yet", () => {
      const watch = watched({ startable: ["TR-5", "TR-6"] });
      markWoken(watch, count({ startable: ["TR-5"] }), minutes(2));
      expect(queuedAlerts(watch, minutes(13), "busy")[0]?.text).toBe(
        "TR-5 and TR-6 queued with a free slot: the plugin told the manager about TR-5 11 minutes ago, and it has not dispatched it; it was too busy to be told about TR-6 yet. Open the manager's tab to see why, or ask it to dispatch the ticket. Unless you dismiss this or tell the manager something, the plugin restarts the manager 20 minutes after it was told.",
      );
    });

    it("adds a ticket once its own wait reaches ten minutes", () => {
      const watch = watched({ startable: ["TR-5"] });
      trackQueue(watch, count({ startable: ["TR-5", "TR-6"] }), minutes(5));
      expect(queuedAlerts(watch, minutes(14), "busy")[0]?.tickets).toEqual(["TR-5"]);
      expect(queuedAlerts(watch, minutes(15), "busy")[0]?.tickets).toEqual(["TR-5", "TR-6"]);
    });

    it("comes down when every ticket it named is dismissed, and back up for a ticket that joins later", () => {
      const watch = watched({ startable: ["TR-5", "TR-6"] });
      for (const id of queuedAlerts(watch, minutes(10), "busy")[0]?.tickets ?? []) watch.dismissed.add(id);
      expect(queuedAlerts(watch, minutes(11), "busy")).toEqual([]);
      trackQueue(watch, count({ startable: ["TR-5", "TR-6", "TR-7"] }), minutes(11));
      expect(queuedAlerts(watch, minutes(20), "busy")).toEqual([]);
      expect(queuedAlerts(watch, minutes(21), "busy")[0]?.tickets).toEqual(["TR-7"]);
    });
  });

  describe("the manager's condition (TR-066)", () => {
    it("says no manager is running and where to start one, never that it is busy", () => {
      const watch = watched();
      expect(queuedAlerts(watch, minutes(10), "missing")).toEqual([
        {
          id: "queued-free-slot",
          tickets: ["TR-5"],
          text: "TR-5 queued with a free slot, but no manager is running, so nothing dispatches it. Start one from the project's settings (⚙): a new manager checks the tracker when it starts.",
        },
      ]);
    });

    it("says the same for tickets a manager was told about before it stopped, with no restart promised", () => {
      const watch = watched({ startable: ["TR-5", "TR-6"] });
      markWoken(watch, count({ startable: ["TR-5", "TR-6"] }), minutes(1));
      const text = queuedAlerts(watch, minutes(30), "missing")[0]?.text;
      expect(text).toBe(
        "TR-5 and TR-6 queued with a free slot, but no manager is running, so nothing dispatches them. Start one from the project's settings (⚙): a new manager checks the tracker when it starts.",
      );
    });

    it("claims a busy manager only when it is busy", () => {
      const watch = watched({ startable: ["TR-5", "TR-6"] });
      markWoken(watch, count({ startable: ["TR-5"] }), minutes(2));
      for (const condition of ["idle", "unresponsive", "missing"] as const) {
        expect(queuedAlerts(watch, minutes(13), condition)[0]?.text).not.toMatch(/busy/);
        expect(queuedAlerts(watched(), minutes(13), condition)[0]?.text).not.toMatch(/busy/);
      }
      expect(queuedAlerts(watch, minutes(13), "idle")[0]?.text).toContain("it has not been told about TR-6 yet");
    });

    it("asks the user to tell an idle manager it could not tell", () => {
      expect(queuedAlerts(watched(), minutes(12), "idle")[0]?.text).toBe(
        "TR-5 queued with a free slot: the plugin has not been able to tell the manager for 12 minutes, though it is idle now. Open the manager's tab and ask it to dispatch the ticket.",
      );
    });

    it("says an unresponsive manager it could not tell will be restarted, unless one was restarted within the hour", () => {
      const watch = watched();
      expect(queuedAlerts(watch, minutes(10), "unresponsive")[0]?.text).toBe(
        "TR-5 queued with a free slot: the manager has stopped responding, so the plugin could not tell it for 10 minutes. Open the manager's tab to see what happened. Unless you dismiss this, the plugin restarts the manager 20 minutes after the ticket was queued.",
      );
      watch.restarts = [minutes(5)];
      expect(queuedAlerts(watch, minutes(10), "unresponsive")[0]?.text).toContain("already restarted the manager within the hour, so it leaves this to you");
    });
  });

  describe("the restart", () => {
    function woken(): QueueWatch {
      const watch = watched();
      markWoken(watch, count(), start);
      return watch;
    }

    it("is due twenty minutes after the wake-up for an idle manager", () => {
      expect(restartDue(woken(), count(), "idle", minutes(20) - 1)).toEqual([]);
      expect(restartDue(woken(), count(), "idle", minutes(20))).toEqual(["TR-5"]);
    });

    it("is due for an unresponsive manager, told or not", () => {
      expect(restartDue(woken(), count(), "unresponsive", minutes(20))).toEqual(["TR-5"]);
      expect(restartDue(watched(), count(), "unresponsive", minutes(20))).toEqual(["TR-5"]);
    });

    it("is never due for an idle manager that was never told: it is woken first", () => {
      expect(restartDue(watched(), count(), "idle", minutes(40))).toEqual([]);
    });

    it("never touches a busy or missing manager", () => {
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

    it("is stopped by the user telling the manager something after the alert, not before", () => {
      const before = woken();
      before.userToldManagerAt = minutes(9);
      expect(restartDue(before, count(), "idle", minutes(25))).toEqual(["TR-5"]);
      const after = woken();
      after.userToldManagerAt = minutes(10);
      expect(restartDue(after, count(), "idle", minutes(25))).toEqual([]);
    });

    it("happens at most once an hour per project, and the alert then says so", () => {
      const watch = woken();
      markRestarted(watch, ["TR-5"], count(), minutes(20), true);
      expect(watch.wokenAt.get("TR-5")).toBe(minutes(20));
      expect(restartDue(watch, count(), "idle", minutes(79))).toEqual([]);
      expect(restartLimited(watch, minutes(79))).toBe(true);
      expect(queuedAlerts(watch, minutes(79), "busy")[0]?.text).toContain("already restarted the manager within the hour, so it leaves this to you");
      expect(restartDue(watch, count(), "idle", minutes(80))).toEqual(["TR-5"]);
    });

    it("does not tell a replaced manager again what its first prompt said", () => {
      const watch = woken();
      markRestarted(watch, ["TR-5"], count(), minutes(20), true);
      expect(shouldWakeIdleManager({ count: count(), managerMidTurn: false, lastTurnEndedAt: minutes(21), lastWokenFor: watch.wokenFor, now: minutes(30) })).toBe(false);
    });

    it("names a restart withheld by the hourly limit once", () => {
      const watch = woken();
      expect(newlyWithheld(watch, count(), "idle", minutes(20))).toEqual([]);
      watch.restarts = [minutes(5)];
      expect(newlyWithheld(watch, count(), "idle", minutes(20))).toEqual(["TR-5"]);
      expect(newlyWithheld(watch, count(), "idle", minutes(21))).toEqual([]);
    });

    it("dates the alert from the earliest of the tickets' ladders", () => {
      const watch = woken();
      markWoken(watch, count({ startable: ["TR-5", "TR-6"] }), minutes(3));
      expect(alertRaisedAt(watch, ["TR-5", "TR-6"])).toBe(minutes(10));
      expect(alertRaisedAt(watch, [])).toBeNull();
    });

    it("counts a failed restart for the hourly limit and leaves the alert up", () => {
      const watch = woken();
      markRestarted(watch, ["TR-5"], count(), minutes(20), false);
      expect(watch.wokenAt.get("TR-5")).toBe(start);
      expect(queuedAlerts(watch, minutes(21), "busy")).toHaveLength(1);
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

  it("leaves a crashed manager to crash recovery until recovery gave up", () => {
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
      owned: "none",
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
