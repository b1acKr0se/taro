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
    const timings = deliveryTimings({ notes, transitions: worked, waiting: [stretch("10:08", "10:20"), stretch("10:40", "10:45")], nudges: 2, permissionWaits: [stretch("10:30", "10:33")] }, Date.parse(at("12:00")));
    expect(timings.planningToAwaitingMs).toBe(ms(60));
    expect(timings.approvedAt).toBe(at("10:20"));
    expect(timings.needsYouBeforeApprovalMs).toBe(ms(12));
    expect(timings.needsYouAfterApprovalMs).toBe(ms(5));
    expect(timings.cardsAnsweredAfterApproval).toBe(2);
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
    expect(deliveryTimings({ notes, transitions: worked, waiting: [], nudges: 1 }).corrections).toEqual({ noPlan: 1, noApproval: 1, held: 3, madeNonBlocking: 1, nudges: 1, untimedNudges: 1 });
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
    expect(old).toMatchObject({ permissionAsks: 0, permissionWaitMs: 0, permissionWaits: [], nudgedAt: [] });
    expect(summarize(old).status).toBe("Done");
    expect(deliveryTimings({ notes: null, transitions: old.transitions, waiting: old.waiting, nudges: old.nudges, nudgedAt: old.nudgedAt, permissionWaits: old.permissionWaits }).permissionWaitMs).toBe(0);
    expect(deliveryTimings({ notes: null, transitions: worked, waiting: [] }).corrections.nudges).toBe(0);
  });
});

describe("cards answered after approval", () => {
  const worked = transitions(["Planning", "10:00"], ["In Progress", "10:30"], ["Awaiting acceptance", "12:00"], ["Done", "12:30"]);
  const approveCard = (time: string) => `ANSWER ${at(time)} — scope-approval: "Approve the plan for AP-1?" → Approve ("Approve the plan for AP-1") (the user, from the Taro screen)`;

  it("counts only the plugin's records, not an owner's copy of the same answer", () => {
    const notes = [approveCard("10:10"), answer("10:40", "pick"), `ANSWER ${at("10:41")} — pick: the user: "A" — noted by the owner`, `ANSWER ${at("10:50")} — other: the user said "B" in chat`].join("\n\n");
    expect(deliveryTimings({ notes, transitions: worked, waiting: [] }).cardsAnsweredAfterApproval).toBe(1);
  });

  it("does not count answers after the round's first Awaiting acceptance", () => {
    const notes = [approveCard("10:10"), answer("11:00", "pick"), answer("12:10", "landing")].join("\n\n");
    expect(deliveryTimings({ notes, transitions: worked, waiting: [] }).cardsAnsweredAfterApproval).toBe(1);
  });

  it("counts a scope approval answered again after the first one, but not the first itself", () => {
    const notes = [approveCard("10:10"), `APPROVAL ${at("10:10")} — user: "Approve the plan for AP-1"`, approveCard("11:30")].join("\n\n");
    expect(deliveryTimings({ notes, transitions: worked, waiting: [] }).cardsAnsweredAfterApproval).toBe(1);
  });

  it("reads the shape of a long ticket: changes requested before approval, four cards after it, a multi-line answer, owner copies and a re-approval", () => {
    const changes = (time: string) => `ANSWER ${at(time)} — scope-approval: "Approve the plan for AP-1?" → Request changes ("why?") (the user, from the Taro screen)`;
    const notes = [
      changes("10:01"),
      changes("10:02"),
      approveCard("10:10"),
      `APPROVAL ${at("10:10")} — user: "Approve the plan for AP-1". Approved the plan as it stands.`,
      `ANSWER ${at("10:20")} — detail: "How detailed?" → "first line\n\nSECOND paragraph after a blank line\nlast line" (the user, from the Taro screen)`,
      `APPROVAL ${at("10:21")} — user: "yes". Approved a scope change (detail).`,
      answer("10:25", "split"),
      answer("10:40", "rulings"),
      `ANSWER ${at("10:40")} — rulings: the user: "Decision, why, cost"`,
      answer("10:45", "chips"),
      `ANSWER ${at("10:45")} — chips: the user: "Keep them at the bottom" — no change`,
      `MILESTONE ${at("10:50")} — children re-split`,
      approveCard("11:00"),
    ].join("\n\n");
    expect(deliveryTimings({ notes, transitions: worked, waiting: [] }).cardsAnsweredAfterApproval).toBe(4 + 1);
  });
});

describe("round limits on nudges and permission waits", () => {
  const history = transitions(["Queued", "09:00"], ["Planning", "10:00"], ["Awaiting acceptance", "11:00"], ["Done", "11:30"]);

  it("counts permission waits only within Planning to the first Awaiting acceptance, overlapping ones once", () => {
    const permissionWaits = [stretch("09:30", "09:40"), stretch("09:55", "10:05"), stretch("10:20", "10:30"), stretch("10:25", "10:35"), stretch("10:20", "10:30"), stretch("10:55", "11:10"), stretch("11:20", "11:25")];
    expect(deliveryTimings({ notes: null, transitions: history, waiting: [], permissionWaits }).permissionWaitMs).toBe(ms(5 + 15 + 5));
  });

  it("counts a reopened round's own waits only", () => {
    const reopened = [...history, ...transitions(["Queued", "12:00"], ["Planning", "12:10"])];
    const notes = `REOPENED ${at("12:00")} — user: "again"; round 2; past owners: none`;
    const timings = deliveryTimings({ notes, transitions: reopened, waiting: [], permissionWaits: [stretch("10:20", "10:30"), stretch("12:20", "12:22")], nudges: 2, nudgedAt: [at("10:30"), at("12:30")] }, Date.parse(at("13:00")));
    expect(timings.permissionWaitMs).toBe(ms(2));
    expect(timings.corrections.nudges).toBe(1);
  });

  it("counts nudges sent within the round, and adds nudges recorded before their times were kept", () => {
    const nudgedAt = [at("09:30"), at("10:30"), at("11:10")];
    expect(deliveryTimings({ notes: null, transitions: history, waiting: [], nudges: 3, nudgedAt }).corrections).toMatchObject({ nudges: 1, untimedNudges: 0 });
    expect(deliveryTimings({ notes: null, transitions: history, waiting: [], nudges: 5, nudgedAt }).corrections).toMatchObject({ nudges: 3, untimedNudges: 2 });
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
