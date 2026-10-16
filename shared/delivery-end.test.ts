import { describe, expect, it } from "vitest";

import { deliveryEndedRecord, deliveryOnOffer, questionEndingDelivery } from "./delivery-end";

const asked = (id: string, blocking: boolean) => ({ id, blocking });

describe("questionEndingDelivery", () => {
  it("picks the first blocking question", () => {
    expect(questionEndingDelivery([asked("tone", false), asked("rename-scope", true), asked("later", true)])).toEqual(asked("rename-scope", true));
  });

  it("ignores non-blocking questions, which carry a default", () => {
    expect(questionEndingDelivery([asked("tone", false)])).toBeNull();
  });

  it("ignores the question an investigation delivers with", () => {
    expect(questionEndingDelivery([asked("investigation-done", true)])).toBeNull();
    expect(questionEndingDelivery([asked("investigation-done", true), asked("follow-up", true)])).toEqual(asked("follow-up", true));
  });

  it("finds nothing when nothing opened", () => {
    expect(questionEndingDelivery([])).toBeNull();
  });
});

describe("deliveryOnOffer", () => {
  const delivered = "EVIDENCE 2026-10-16T00:08Z — before FINAL\ncheck: npm test — green";

  it("holds while the ticket awaits acceptance", () => {
    expect(deliveryOnOffer({ status: "Awaiting acceptance", notes: delivered })).toBe(true);
    expect(deliveryOnOffer({ status: "Awaiting acceptance", notes: null })).toBe(true);
  });

  it("ends once the user accepted: the owner is merging", () => {
    const accepted = `${delivered}\n\nACCEPTED 2026-10-16T00:10:55.123Z — the user accepted; merging: the pull request`;
    expect(deliveryOnOffer({ status: "Awaiting acceptance", notes: accepted })).toBe(false);
  });

  it("holds again after an Accept that did not merge", () => {
    const notMerged = `${delivered}\n\nACCEPTED 2026-10-16T00:10Z — the user accepted; merging: none\n\nNOT-MERGED 2026-10-16T00:11Z — the main checkout has uncommitted changes`;
    expect(deliveryOnOffer({ status: "Awaiting acceptance", notes: notMerged })).toBe(true);
  });

  it("ends once the pull request merged and only the local base branch is behind (NOT-SYNCED)", () => {
    const notSynced = `${delivered}\n\nACCEPTED 2026-10-16T00:10Z — the user accepted; merging: the pull request\n\nNOT-SYNCED 2026-10-16T00:11Z — the main checkout has uncommitted changes`;
    expect(deliveryOnOffer({ status: "Awaiting acceptance", notes: notSynced })).toBe(false);
  });

  it("is off for every other status", () => {
    for (const status of ["Planning", "In Progress", "Reviewing", "Blocked", "Done", "Cancelled"]) expect(deliveryOnOffer({ status, notes: delivered })).toBe(false);
  });
});

describe("deliveryEndedRecord", () => {
  it("names the question and the new status", () => {
    expect(deliveryEndedRecord("2026-10-16T00:40:00.000Z", "rename-scope")).toBe(
      "DELIVERY-ENDED 2026-10-16T00:40:00.000Z — the owner asked `rename-scope` while awaiting acceptance: back to In Progress until it delivers again",
    );
  });
});
