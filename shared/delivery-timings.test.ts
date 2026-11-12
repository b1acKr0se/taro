import { describe, expect, it } from "vitest";

import { deliveryTimings, spreadOf } from "./delivery-timings";
import { summarize, TicketStatsSchema } from "./stats";

const at = (time: string): string => `2026-11-01T${time}Z`;
const ms = (minutes: number): number => minutes * 60_000;
const transitions = (...steps: [string, string][]) => steps.map(([to, time]) => ({ to, at: at(time) }));
const stretch = (start: string, end: string) => ({ start: at(start), end: at(end) });
const approval = (time: string) => `APPROVAL ${at(time)} — the user: "Approve"`;
const answer = (time: string, id: string) => `ANSWER ${at(time)} — ${id}: "Q?" → Yes (the user, from the Taro screen)`;

describe("deliveryTimings", () => {
  const worked = transitions(["Queued", "10:00"], ["Planning", "10:05"], ["In Progress", "10:30"], ["Awaiting acceptance", "11:05"], ["Done", "11:30"]);

  it("measures Planning to the first Awaiting acceptance and splits Needs you at the approval", () => {
    const notes = [approval("10:20"), answer("10:40", "which-library"), answer("10:50", "scope-approval"), answer("10:10", "early-card")].join("\n\n");
    const timings = deliveryTimings({ notes, transitions: worked, waiting: [stretch("10:08", "10:20"), stretch("10:40", "10:45")], nudges: 2, permissionWaitMs: ms(3) }, Date.parse(at("12:00")));
    expect(timings.planningToAwaitingMs).toBe(ms(60));
    expect(timings.approvedAt).toBe(at("10:20"));
    expect(timings.needsYouBeforeApprovalMs).toBe(ms(12));
    expect(timings.needsYouAfterApprovalMs).toBe(ms(5));
    expect(timings.cardsAnsweredAfterApproval).toBe(1);
    expect(timings.permissionWaitMs).toBe(ms(3));
    expect(timings.corrections.nudges).toBe(2);
  });

  it("a card spanning the approval counts its part on each side", () => {
    const timings = deliveryTimings({ notes: approval("10:20"), transitions: worked, waiting: [stretch("10:10", "10:35")] });
    expect(timings.needsYouBeforeApprovalMs).toBe(ms(10));
    expect(timings.needsYouAfterApprovalMs).toBe(ms(15));
  });

  it("with no approval all the Needs-you time is before it, and no card counts as after", () => {
    const timings = deliveryTimings({ notes: answer("10:40", "which-library"), transitions: worked, waiting: [stretch("10:10", "10:25")] });
    expect(timings).toMatchObject({ approvedAt: null, needsYouBeforeApprovalMs: ms(15), needsYouAfterApprovalMs: 0, cardsAnsweredAfterApproval: 0 });
  });

  it("counts a child's repeated stretch once, and only the time before the first Awaiting acceptance", () => {
    const timings = deliveryTimings({ notes: null, transitions: worked, waiting: [stretch("10:10", "10:20"), stretch("10:15", "10:25"), stretch("11:00", "11:20")] });
    expect(timings.needsYouBeforeApprovalMs).toBe(ms(15 + 5));
  });

  it("counts the plugin's corrections from the round's records", () => {
    const notes = [
      `NO-PLAN ${at("10:01")} — 1 commit on b past main with no plan on the ticket: x`,
      `NO-APPROVAL ${at("10:02")} — 2 commits on b past main with the plan not approved this round: x`,
      approval("10:03"),
      `APPROVAL-REPEATED ${at("10:04")} — \`scope-approval\` asked again after the plan was approved, with no surprise: not shown; the owner was told to build on`,
      `BLOCKING-AFTER-APPROVAL ${at("10:05")} — \`a\` asked blocking after approval, with no surprise: shown not blocking, the owner going on with "Yes"`,
      `BLOCKING-AFTER-APPROVAL ${at("10:06")} — \`b\` asked blocking after approval, with no surprise and no default: not shown`,
      `BLOCKING-AFTER-APPROVAL ${at("10:07")} — \`c\` asked several questions on one card after approval: not shown; the owner was told to ask one at a time`,
    ].join("\n\n");
    expect(deliveryTimings({ notes, transitions: worked, waiting: [], nudges: 1 }).corrections).toEqual({ noPlan: 1, noApproval: 1, held: 3, madeNonBlocking: 1, nudges: 1 });
  });

  it("reads only the reopened round: its Planning, its approval and its records", () => {
    const history = transitions(["Queued", "09:00"], ["Planning", "09:05"], ["Awaiting acceptance", "09:40"], ["Done", "09:50"], ["Queued", "12:00"], ["Planning", "12:10"], ["In Progress", "12:20"], ["Awaiting acceptance", "12:50"]);
    const notes = [approval("09:10"), `NO-PLAN ${at("09:01")} — x`, `REOPENED ${at("12:00")} — user: "again"; round 2; past owners: none`, `NO-APPROVAL ${at("12:15")} — x`, approval("12:18"), answer("12:30", "x")].join("\n\n");
    const timings = deliveryTimings({ notes, transitions: history, waiting: [stretch("09:06", "09:09"), stretch("12:11", "12:25")] });
    expect(timings.planningAt).toBe(at("12:10"));
    expect(timings.planningToAwaitingMs).toBe(ms(40));
    expect(timings.approvedAt).toBe(at("12:18"));
    expect(timings.needsYouBeforeApprovalMs).toBe(ms(7));
    expect(timings.needsYouAfterApprovalMs).toBe(ms(7));
    expect(timings.cardsAnsweredAfterApproval).toBe(1);
    expect(timings.corrections).toMatchObject({ noPlan: 0, noApproval: 1 });
  });

  it("a ticket still in Planning has no wall time yet, and its Needs-you time runs to now", () => {
    const timings = deliveryTimings({ notes: null, transitions: transitions(["Queued", "10:00"], ["Planning", "10:05"]), waiting: [stretch("10:06", "10:16")] }, Date.parse(at("10:30")));
    expect(timings.planningToAwaitingMs).toBeNull();
    expect(timings.planningAt).toBe(at("10:05"));
    expect(timings.needsYouBeforeApprovalMs).toBe(ms(10));
  });

  it("a ticket that never planned has nothing to measure", () => {
    const timings = deliveryTimings({ notes: null, transitions: transitions(["Queued", "10:00"], ["In Progress", "10:01"], ["Awaiting acceptance", "10:20"]), waiting: [stretch("10:02", "10:10")] });
    expect(timings).toMatchObject({ planningAt: null, planningToAwaitingMs: null, needsYouBeforeApprovalMs: 0, needsYouAfterApprovalMs: 0 });
  });

  it("reads a stats file written before the new fields: they load as zero", () => {
    const old = TicketStatsSchema.parse({ project: "app", ticket: "AP-1", transitions: worked.map((each) => ({ from: null, ...each })) });
    expect(old).toMatchObject({ permissionAsks: 0, permissionWaitMs: 0 });
    expect(summarize(old).status).toBe("Done");
    expect(deliveryTimings({ notes: null, transitions: old.transitions, waiting: old.waiting, nudges: old.nudges, permissionWaitMs: old.permissionWaitMs }).permissionWaitMs).toBe(0);
    expect(deliveryTimings({ notes: null, transitions: worked, waiting: [] }).corrections.nudges).toBe(0);
  });
});

describe("spreadOf", () => {
  it("gives the median and the nearest-rank 90th percentile", () => {
    expect(spreadOf([])).toBeNull();
    expect(spreadOf([5])).toEqual({ count: 1, median: 5, p90: 5 });
    expect(spreadOf([4, 1, 3, 2])).toEqual({ count: 4, median: 2.5, p90: 4 });
    expect(spreadOf(Array.from({ length: 10 }, (_, index) => index + 1))).toEqual({ count: 10, median: 5.5, p90: 9 });
  });
});
