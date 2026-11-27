// TR-293: an item stays hidden only while what it waits on is what it was when hidden.
import { describe, expect, it } from "vitest";

import { hiddenKey, listStaysOpen, stillHides, ticketFingerprint } from "./hidden";

describe("ticketFingerprint", () => {
  const base = { status: "Blocked", questionKeys: ["a:one"], lastState: "blocked" };

  it("is the same for the same wait, whatever the order of its questions", () => {
    expect(ticketFingerprint({ ...base, questionKeys: ["b", "a"] })).toBe(ticketFingerprint({ ...base, questionKeys: ["a", "b"] }));
  });

  it("changes with a new question, a new status or a new last status line", () => {
    const before = ticketFingerprint(base);
    expect(ticketFingerprint({ ...base, questionKeys: ["a:one", "a:two"] })).not.toBe(before);
    expect(ticketFingerprint({ ...base, status: "Awaiting acceptance" })).not.toBe(before);
    expect(ticketFingerprint({ ...base, lastState: "failed" })).not.toBe(before);
    expect(ticketFingerprint({ ...base, lastState: null })).not.toBe(before);
  });
});

describe("stillHides", () => {
  it("holds only for the fingerprint it was hidden with", () => {
    const entry = { key: hiddenKey("ticket", "TR-1"), at: "2026-01-01T00:00:00Z", fingerprint: "x" };
    expect(stillHides(entry, "x")).toBe(true);
    expect(stillHides(entry, "y")).toBe(false);
  });
  it("keys a ticket and a question apart", () => {
    expect(hiddenKey("ticket", "TR-1")).toBe("ticket:TR-1");
    expect(hiddenKey("question", "a:b")).toBe("question:a:b");
  });
});

describe("listStaysOpen", () => {
  it("closes for good once the last item is gone, so it does not reopen when another is hidden", () => {
    expect(listStaysOpen(true, 2)).toBe(true);
    expect(listStaysOpen(true, 0)).toBe(false);
    expect(listStaysOpen(false, 3)).toBe(false);
  });
});
