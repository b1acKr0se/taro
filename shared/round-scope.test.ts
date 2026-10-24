/** Every reader of delivery state reads only the round in progress after a Reopen (TR-229); history views read every round. */
import { describe, expect, it } from "vitest";

import { deliveryOnOffer } from "./delivery-end";
import { parseEvidence } from "./evidence";
import {
  acceptanceMerge,
  acceptedRecord,
  acceptedRecordText,
  executionBranch,
  executionMachine,
  executionOwners,
  executionWorkspace,
  noteRecords,
  notMergedRecord,
  pluginAcceptPending,
  pullRequestMerged,
  pullRequestUrl,
  reviewHead,
} from "./execution";
import { ticketMilestones } from "./milestones";
import { pausedHold, pauseRequestedAt, queuedToResume } from "./pause";
import { lastPlanAnswer, planAnswerRecords } from "./plan-changes";
import { planningTicket } from "./planning-questions";
import { holdReason } from "./queue-check";
import { reopenedRecordText } from "./reopen";

const OLD_HEAD = "a".repeat(40);
const NEW_HEAD = "b".repeat(40);
const OLD_OWNER = "aaaaaaaa-1111-4111-8111-111111111111";
const NEW_OWNER = "bbbbbbbb-2222-4222-8222-222222222222";
const OLD_PR = "https://github.com/acme/notes-app/pull/12";
const NEW_PR = "https://github.com/acme/notes-app/pull/31";

/** A full first round: owned, approved, presented, accepted and merged. */
const ROUND_ONE = [
  `EXECUTION 2026-10-01T10:00Z — owner ${OLD_OWNER}, workspace wks_old1, branch taro/tr-9, host devbox-old`,
  'ANSWER 2026-10-01T10:30:00.000Z — scope-approval: "Approve the plan for TR-9?" → Approve ("Approve the plan for TR-9")',
  'APPROVAL 2026-10-01T10:31Z — user: "Approve the plan for TR-9"',
  `EXECUTION 2026-10-01T12:00Z — review-head: ${OLD_HEAD}; pr: ${OLD_PR}`,
  "EVIDENCE 2026-10-01T12:05Z — delivery\ncheck: npm test — 120 passed\nreview: clean\nscreenshots: none — server only",
  "PAUSE-REQUESTED 2026-10-01T12:10Z — the user pressed Park",
  "HOLD 2026-10-01T12:20Z — parked by the user; no handoff",
  "RELEASE 2026-10-01T13:00Z — resumed by the user; queued to resume: no free slot (owners 2 of 2)",
  acceptedRecordText("2026-10-02T09:00Z", "the pull request", true),
  "NOT-MERGED 2026-10-02T09:05Z — the main checkout was dirty",
  acceptedRecordText("2026-10-02T09:10Z", "the pull request", true),
  `ACCEPTANCE 2026-10-02T09:20Z — ${OLD_PR} MERGED; merge: merged 0a1b2c3`,
].join("\n\n");

const REOPENED = reopenedRecordText({
  at: "2026-10-10T08:00:00.000Z",
  note: "verify it on prod",
  round: 2,
  pastOwners: [OLD_OWNER],
  finalSummary: `FINAL 2026-10-02T09:30Z — shipped\npr: ${OLD_PR}\nreview-head: ${OLD_HEAD}`,
});

const reopenedNotes = `${ROUND_ONE}\n\n${REOPENED}`;

describe("a reopened ticket's earlier round", () => {
  it("is what the readers find before the Reopen (unchanged behaviour)", () => {
    expect(reviewHead(ROUND_ONE)).toBe(OLD_HEAD);
    expect(pullRequestUrl(ROUND_ONE, null)).toBe(OLD_PR);
    expect(acceptanceMerge(ROUND_ONE)).toBe("merged 0a1b2c3");
    expect(pullRequestMerged(ROUND_ONE)).toBe(true);
    expect(parseEvidence(ROUND_ONE)?.checks).toHaveLength(1);
    expect(lastPlanAnswer(ROUND_ONE)?.kind).toBe("approved");
    expect(planningTicket({ status: "Planning", notes: ROUND_ONE })).toBe(false);
    expect(queuedToResume(ROUND_ONE)).toBe(true);
    expect(executionBranch(ROUND_ONE)).toBe("taro/tr-9");
    expect(executionWorkspace(ROUND_ONE)).toBe("wks_old1");
  });

  it("no longer counts once REOPENED follows it", () => {
    const notes = reopenedNotes;
    expect(acceptedRecord(notes)).toBeNull();
    expect(pluginAcceptPending(notes)).toBe(false);
    expect(notMergedRecord(notes)).toBeNull();
    expect(pullRequestMerged(notes)).toBe(false);
    expect(acceptanceMerge(notes)).toBeNull();
    expect(reviewHead(notes)).toBeNull();
    // The cleared final summary is gone; the copy kept in the REOPENED record is not read.
    expect(pullRequestUrl(notes, null)).toBeNull();
    expect(parseEvidence(notes)).toBeNull();
    expect(lastPlanAnswer(notes)).toBeNull();
    expect(planningTicket({ status: "Planning", notes })).toBe(true);
    expect(deliveryOnOffer({ status: "Awaiting acceptance", notes })).toBe(true);
    expect(holdReason(notes)).toBeNull();
    expect(pausedHold(notes)).toBeNull();
    expect(queuedToResume(notes)).toBe(false);
    expect(pauseRequestedAt(notes)).toBeNull();
    expect(executionBranch(notes)).toBeNull();
    expect(executionWorkspace(notes)).toBeNull();
    expect(executionMachine(notes)).toBeNull();
  });

  it("still shows in the history views", () => {
    expect(ticketMilestones(reopenedNotes).length).toBeGreaterThan(ticketMilestones(ROUND_ONE).length);
    expect(planAnswerRecords(reopenedNotes)).toHaveLength(2);
    expect(executionOwners(reopenedNotes)).toEqual([OLD_OWNER]);
    expect(noteRecords(reopenedNotes).filter((record) => record.startsWith("REOPENED"))).toHaveLength(1);
  });
});

describe("the new round's records", () => {
  const roundTwo = [
    `EXECUTION 2026-10-10T08:10Z — owner ${NEW_OWNER}, workspace wks_new2, branch taro/tr-9-2, host devbox-new`,
    'APPROVAL 2026-10-10T08:30Z — user: "Approve the plan for TR-9"',
    `EXECUTION 2026-10-10T09:00Z — review-head: ${NEW_HEAD}; pr: ${NEW_PR}`,
    "EVIDENCE 2026-10-10T09:05Z — delivery\ncheck: npm test — 121 passed\ncheck: curl prod — 200\nreview: clean\nscreenshots: none — server only",
  ];
  const presented = `${reopenedNotes}\n\n${roundTwo.join("\n\n")}`;

  it("are found after the REOPENED record", () => {
    expect(reviewHead(presented)).toBe(NEW_HEAD);
    expect(pullRequestUrl(presented, null)).toBe(NEW_PR);
    expect(parseEvidence(presented)?.checks).toHaveLength(2);
    expect(lastPlanAnswer(presented)?.at).toBe("2026-10-10T08:30Z");
    expect(planningTicket({ status: "Planning", notes: presented })).toBe(false);
    expect(executionBranch(presented)).toBe("taro/tr-9-2");
    expect(executionWorkspace(presented)).toBe("wks_new2");
    expect(executionMachine(presented)).toBe("devbox-new");
    expect(executionOwners(presented)).toEqual([OLD_OWNER, NEW_OWNER]);
  });

  it("accept and merge in the new round", () => {
    const accepted = `${presented}\n\n${acceptedRecordText("2026-10-10T10:00Z", "the pull request", true)}`;
    expect(acceptedRecord(accepted)).toEqual({ at: "2026-10-10T10:00Z", merging: "the pull request" });
    expect(pluginAcceptPending(accepted)).toBe(true);
    expect(deliveryOnOffer({ status: "Awaiting acceptance", notes: accepted })).toBe(false);
    const merged = `${accepted}\n\nACCEPTANCE 2026-10-10T10:05Z — ${NEW_PR} MERGED; merge: merged 9f8e7d6`;
    expect(pullRequestMerged(merged)).toBe(true);
    expect(acceptanceMerge(merged)).toBe("merged 9f8e7d6");
    expect(pluginAcceptPending(merged)).toBe(false);
  });

  it("park and hold in the new round", () => {
    const held = `${presented}\n\nHOLD 2026-10-10T11:00Z — parked by the user; no handoff`;
    expect(pausedHold(held)).toMatchObject({ at: "2026-10-10T11:00Z", withoutHandoff: true });
    expect(holdReason(held)).toBe("parked by the user; no handoff");
  });

  it("only count after the second of two REOPENED records", () => {
    const third = reopenedRecordText({ at: "2026-10-20T08:00Z", note: "once more", round: 3, pastOwners: [OLD_OWNER, NEW_OWNER], finalSummary: null });
    const accepted = `${presented}\n\n${acceptedRecordText("2026-10-10T10:00Z", "the pull request")}\n\nACCEPTANCE 2026-10-10T10:05Z — merge: merged 9f8e7d6\n\n${third}`;
    expect(acceptedRecord(accepted)).toBeNull();
    expect(acceptanceMerge(accepted)).toBeNull();
    expect(reviewHead(accepted)).toBeNull();
    expect(parseEvidence(accepted)).toBeNull();
    const roundThree = `${accepted}\n\nEVIDENCE 2026-10-20T09:00Z — verify\ncheck: curl prod — 200\n\n${acceptedRecordText("2026-10-20T09:30Z", null)}`;
    expect(parseEvidence(roundThree)?.checks).toEqual([{ command: "curl prod", result: "200" }]);
    expect(acceptedRecord(roundThree)).toEqual({ at: "2026-10-20T09:30Z", merging: null });
  });
});
