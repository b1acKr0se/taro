import { describe, expect, it } from "vitest";

import {
  handoffSincePauseRequest,
  PAUSE_HANDOFF_TIMEOUT_MS,
  pausedByTaro,
  pausedHold,
  pausedHoldText,
  pauseProgress,
  pauseView,
  pauseRefusal,
  pauseRequestedAt,
  queuedToResume,
  resumedReleaseText,
  resumeRefusal,
  resumesNow,
} from "./pause";
import { holdReason } from "./queue-check";

const EXECUTION = "EXECUTION 2026-01-05T09:00:00Z owner=a1 workspace=wks_1 worktree=/home/user/notes-app branch=taro/na-1 base=abc host=box";
const REQUESTED = "PAUSE-REQUESTED 2026-01-05T10:00:12Z — the user pressed Pause; waiting up to 10 minutes for the owner's HANDOFF";
const HANDOFF = "HANDOFF 2026-01-05T10:03Z\nWhere: list built, tests green.\nNext: review.";
const notes = (...records: string[]) => records.join("\n\n");

describe("pausedHold", () => {
  it("reads a pause with a handoff", () => {
    const text = notes(EXECUTION, REQUESTED, HANDOFF, pausedHoldText("2026-01-05T10:04Z", "handoff", true));
    expect(pausedHold(text)).toEqual({ at: "2026-01-05T10:04Z", withoutHandoff: false });
  });

  it("reads a pause without a handoff after the timeout", () => {
    const text = notes(EXECUTION, REQUESTED, pausedHoldText("2026-01-05T10:10Z", "timed-out", false));
    expect(pausedHold(text)).toEqual({ at: "2026-01-05T10:10Z", withoutHandoff: true });
    expect(holdReason(text)).toContain("did not write one within 10 minutes");
  });

  it("reads a pause written by hand", () => {
    expect(pausedHold(notes(EXECUTION, "HOLD 2026-01-05T11:00Z — paused by the user to unblock a rewrite; resume from this HANDOFF"))).toEqual({
      at: "2026-01-05T11:00Z",
      withoutHandoff: false,
    });
  });

  it("ignores the Manager's own holds and a pause lifted by RELEASE", () => {
    expect(pausedHold(notes("HOLD 2026-01-05T10:00Z — exclusive rewrite NA-10 first"))).toBeNull();
    expect(pausedHold(notes(pausedHoldText("2026-01-05T10:04Z", "handoff", true), resumedReleaseText("2026-01-05T11:00Z", null)))).toBeNull();
    expect(pausedHold(null)).toBeNull();
  });
});

describe("queuedToResume", () => {
  const paused = pausedHoldText("2026-01-05T10:04Z", "handoff", true);
  const queued = resumedReleaseText("2026-01-05T11:00Z", { counting: 3, cap: 3 });

  it("is set by a RELEASE queued to resume", () => {
    expect(queued).toContain("owners 3 of 3");
    expect(queuedToResume(notes(EXECUTION, paused, queued))).toBe(true);
  });

  it("is cleared by the plugin's RESUMED record or the new owner's EXECUTION record", () => {
    expect(queuedToResume(notes(paused, queued, "RESUMED 2026-01-05T11:20:00Z — a slot freed: the plugin started a fresh owner a2"))).toBe(false);
    expect(queuedToResume(notes(paused, queued, EXECUTION))).toBe(false);
  });

  it("is not set by a resume that started at once, a Manager's release, or a later pause", () => {
    expect(queuedToResume(notes(paused, resumedReleaseText("2026-01-05T11:00Z", null)))).toBe(false);
    expect(queuedToResume(notes("HOLD 2026-01-05T10:00Z — rewrite first", "RELEASE 2026-01-05T11:00Z — rewrite done"))).toBe(false);
    expect(queuedToResume(notes(paused, queued, pausedHoldText("2026-01-05T12:00Z", "owner-gone", false)))).toBe(false);
  });
});

describe("pauseRequestedAt and handoffSincePauseRequest", () => {
  it("finds the request and a HANDOFF written after it, not one before", () => {
    expect(pauseRequestedAt(notes(EXECUTION, REQUESTED))).toBe("2026-01-05T10:00:12Z");
    expect(handoffSincePauseRequest(notes(HANDOFF, REQUESTED))).toBe(false);
    expect(handoffSincePauseRequest(notes(REQUESTED, "MILESTONE 2026-01-05T10:01Z — x", HANDOFF))).toBe(true);
  });

  it("ends with the HOLD that completes the pause", () => {
    expect(pauseRequestedAt(notes(REQUESTED, HANDOFF, pausedHoldText("2026-01-05T10:04Z", "handoff", true)))).toBeNull();
    expect(pauseRequestedAt(null)).toBeNull();
  });
});

describe("pauseProgress", () => {
  const requestedAt = Date.parse("2026-01-05T10:00:12Z");
  const base = { requestedAt, now: requestedAt + 60_000, ownerAlive: true, ownerMidTurn: false };

  it("pauses with the handoff once the owner's turn is over", () => {
    expect(pauseProgress({ ...base, notes: notes(REQUESTED, HANDOFF) })).toBe("handoff");
    expect(pauseProgress({ ...base, notes: notes(REQUESTED, HANDOFF), ownerMidTurn: true })).toBe("waiting");
  });

  it("waits for the handoff, then gives up at the timeout", () => {
    expect(pauseProgress({ ...base, notes: notes(REQUESTED) })).toBe("waiting");
    expect(pauseProgress({ ...base, notes: notes(REQUESTED), now: requestedAt + PAUSE_HANDOFF_TIMEOUT_MS - 1 })).toBe("waiting");
    expect(pauseProgress({ ...base, notes: notes(REQUESTED), now: requestedAt + PAUSE_HANDOFF_TIMEOUT_MS })).toBe("timed-out");
    expect(pauseProgress({ ...base, notes: notes(REQUESTED), ownerMidTurn: true, now: requestedAt + PAUSE_HANDOFF_TIMEOUT_MS })).toBe("timed-out");
  });

  it("pauses at once when the owner is gone", () => {
    expect(pauseProgress({ ...base, notes: notes(REQUESTED), ownerAlive: false })).toBe("owner-gone");
  });
});

describe("pausedHoldText", () => {
  it("says where the next owner resumes from", () => {
    expect(pausedHoldText("2026-01-05T10:04Z", "handoff", true)).toBe("HOLD 2026-01-05T10:04Z — paused by the user; resume from the latest HANDOFF");
    expect(pausedHoldText("2026-01-05T10:04Z", "owner-gone", false)).toBe(
      "HOLD 2026-01-05T10:04Z — paused by the user; no handoff (the owner had already stopped): resume from the latest milestone",
    );
    // An owner gone after writing its handoff still leaves one to resume from.
    expect(pausedHoldText("2026-01-05T10:04Z", "owner-gone", true)).toContain("resume from the latest HANDOFF");
  });
});

describe("pauseRefusal", () => {
  const ticket = { id: "NA-1", status: "In Progress", parentTaskId: null, notes: EXECUTION };

  it("allows a ticket under way", () => {
    for (const status of ["Planning", "Ready", "In Progress", "Reviewing", "Blocked"]) expect(pauseRefusal({ ...ticket, status }, false)).toBeNull();
  });

  it("refuses while awaiting acceptance or merging, with different words", () => {
    expect(pauseRefusal({ ...ticket, status: "Awaiting acceptance" }, false)).toBe("NA-1 is awaiting your acceptance: accept it or request changes instead.");
    expect(pauseRefusal({ ...ticket, status: "Awaiting acceptance" }, true)).toBe("NA-1 is merging: wait for it to finish.");
  });

  it("refuses finished, unstarted, child, paused and pausing tickets", () => {
    expect(pauseRefusal({ ...ticket, status: "Done" }, false)).toBe("NA-1 is Done: there is nothing to pause.");
    expect(pauseRefusal({ ...ticket, status: "Cancelled" }, false)).toContain("nothing to pause");
    expect(pauseRefusal({ ...ticket, status: "Queued" }, false)).toContain("has not started");
    expect(pauseRefusal({ ...ticket, parentTaskId: "NA-0" }, false)).toBe("NA-1 is a child: pause its parent NA-0 instead.");
    expect(pauseRefusal({ ...ticket, notes: notes(EXECUTION, pausedHoldText("2026-01-05T10:04Z", "handoff", true)) }, false)).toBe("NA-1 is already paused.");
    expect(pauseRefusal({ ...ticket, notes: notes(EXECUTION, REQUESTED) }, false)).toContain("already pausing");
    const queued = notes(EXECUTION, pausedHoldText("2026-01-05T10:04Z", "handoff", true), resumedReleaseText("2026-01-05T11:00Z", { counting: 3, cap: 3 }));
    expect(pauseRefusal({ ...ticket, notes: queued }, false)).toBe("NA-1 is queued to resume: it has no owner to pause yet.");
    // Once its fresh owner runs, it may pause again.
    expect(pauseRefusal({ ...ticket, notes: notes(queued, "RESUMED 2026-01-05T11:20:00Z — a slot freed") }, false)).toBeNull();
  });
});

describe("resumeRefusal", () => {
  const paused = { id: "NA-1", status: "In Progress", parentTaskId: null, notes: notes(EXECUTION, pausedHoldText("2026-01-05T10:04Z", "handoff", true)) };

  it("allows a paused ticket with no live owner", () => {
    expect(resumeRefusal(paused, false, false)).toBeNull();
  });

  it("refuses while awaiting acceptance or merging", () => {
    expect(resumeRefusal({ ...paused, status: "Awaiting acceptance" }, false, false)).toContain("awaiting your acceptance");
    expect(resumeRefusal({ ...paused, status: "Awaiting acceptance" }, true, false)).toBe("NA-1 is merging: wait for it to finish.");
  });

  it("refuses a ticket not paused, already queued to resume, or with a live owner", () => {
    expect(resumeRefusal({ ...paused, notes: EXECUTION }, false, false)).toBe("NA-1 is not paused.");
    expect(resumeRefusal({ ...paused, notes: notes(paused.notes, resumedReleaseText("2026-01-05T11:00Z", { counting: 3, cap: 3 })) }, false, false)).toBe(
      "NA-1 is already queued to resume.",
    );
    expect(resumeRefusal(paused, false, true)).toContain("live owner");
  });
});

describe("resumesNow", () => {
  const order = ["NA-1", "NA-2", "NA-3", "NA-4"];
  const base = { order, startable: [] as string[], counting: 2, cap: 3, headroom: true };

  it("takes a free slot", () => {
    expect(resumesNow({ ...base, ticket: "NA-3" })).toBe(true);
  });

  it("waits with no free slot or no thread headroom", () => {
    expect(resumesNow({ ...base, ticket: "NA-3", counting: 3 })).toBe(false);
    expect(resumesNow({ ...base, ticket: "NA-3", counting: 4 })).toBe(false);
    expect(resumesNow({ ...base, ticket: "NA-3", headroom: false })).toBe(false);
  });

  it("leaves the slot to an older startable queued ticket, but not to a newer one", () => {
    expect(resumesNow({ ...base, ticket: "NA-3", startable: ["NA-1"] })).toBe(false);
    expect(resumesNow({ ...base, ticket: "NA-3", startable: ["NA-4"] })).toBe(true);
    expect(resumesNow({ ...base, ticket: "NA-3", startable: ["NA-1"], counting: 1 })).toBe(true);
    expect(resumesNow({ ...base, ticket: "NA-3", startable: ["NA-1", "NA-2"], counting: 1 })).toBe(false);
  });
});

describe("pauseView", () => {
  const paused = pausedHoldText("2026-01-05T10:04Z", "timed-out", false);

  it("says pausing while the owner writes its handoff, alive or not", () => {
    expect(pauseView(notes(EXECUTION, REQUESTED), true)).toEqual({ state: "pausing", since: "2026-01-05T10:00:12Z", withoutHandoff: false });
    expect(pauseView(notes(EXECUTION, REQUESTED), false)?.state).toBe("pausing");
  });

  it("says paused, and queued to resume, only with no live owner", () => {
    expect(pauseView(notes(REQUESTED, paused), false)).toEqual({ state: "paused", since: "2026-01-05T10:04Z", withoutHandoff: true });
    expect(pauseView(notes(REQUESTED, paused), true)).toBeNull();
    const queued = notes(REQUESTED, paused, resumedReleaseText("2026-01-05T11:00Z", { counting: 3, cap: 3 }));
    expect(pauseView(queued, false)).toEqual({ state: "queued-to-resume", since: "2026-01-05T11:00Z", withoutHandoff: false });
    expect(pauseView(queued, true)).toBeNull();
  });

  it("is null for a ticket never paused", () => {
    expect(pauseView(EXECUTION, false)).toBeNull();
    expect(pauseView(null, false)).toBeNull();
  });
});

describe("pausedByTaro", () => {
  const hold = pausedHoldText("2026-01-05T10:04Z", "handoff", true);

  it("is true for a pause Taro asked for and held", () => {
    expect(pausedByTaro(notes(EXECUTION, REQUESTED, HANDOFF, hold))).toBe(true);
    expect(pausedByTaro(notes(EXECUTION, REQUESTED, pausedHoldText("2026-01-05T10:10Z", "timed-out", false)))).toBe(true);
  });

  it("is false for a pause written by hand, with no request before it", () => {
    expect(pausedByTaro(notes(EXECUTION, "HOLD 2026-01-05T11:00Z — paused by the user to unblock a rewrite; resume from this HANDOFF"))).toBe(false);
  });

  it("is false while the pause is still pending, and after a resume", () => {
    expect(pausedByTaro(notes(EXECUTION, REQUESTED))).toBe(false);
    expect(pausedByTaro(notes(EXECUTION, REQUESTED, hold, resumedReleaseText("2026-01-05T11:00Z", null)))).toBe(false);
  });

  it("is false when an earlier request belongs to an earlier pause", () => {
    const handHold = "HOLD 2026-01-05T12:00Z — paused by the user again, by hand";
    expect(pausedByTaro(notes(EXECUTION, REQUESTED, hold, resumedReleaseText("2026-01-05T11:00Z", null), handHold))).toBe(false);
  });

  it("is false for a manager's hold and for empty notes", () => {
    expect(pausedByTaro(notes(EXECUTION, REQUESTED, "HOLD 2026-01-05T10:05Z — waits for NA-2"))).toBe(false);
    expect(pausedByTaro(null)).toBe(false);
    expect(pausedByTaro("")).toBe(false);
  });
});
