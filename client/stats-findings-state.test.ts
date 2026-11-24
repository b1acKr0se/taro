import { describe, expect, it } from "vitest";

import { findingsFolded, findingsSection, highPerTicketText, reviewedText } from "./stats-findings-state";

const sonnet = { model: "claude-sonnet-5-5", tickets: 12, high: 3, medium: 14, low: 6, escapes: 2 };
const all = { model: "All models", tickets: 12, high: 3, medium: 14, low: 6, escapes: 2 };

describe("findingsSection", () => {
  it("shows the rows when loaded", () => {
    expect(findingsSection({ data: { models: [sonnet], all }, error: null })).toEqual({ kind: "rows", all, models: [sonnet] });
  });

  it("keeps the rows when a later refetch fails", () => {
    expect(findingsSection({ data: { models: [sonnet], all }, error: new Error("offline") }).kind).toBe("rows");
  });

  it("shows the empty state with no rows", () => {
    expect(findingsSection({ data: { models: [], all: { ...all, tickets: 0, high: 0, medium: 0, low: 0, escapes: 0 } }, error: null })).toEqual({ kind: "empty" });
  });

  it("leaves out a row without a model name", () => {
    expect(findingsSection({ data: { models: [{ ...sonnet, model: "" }], all }, error: null })).toEqual({ kind: "empty" });
  });

  it("hides the empty state when asked, and still shows rows", () => {
    const empty = { models: [], all: { ...all, tickets: 0, high: 0, medium: 0, low: 0, escapes: 0 } };
    expect(findingsSection({ data: empty, error: null }, { hideWhenEmpty: true })).toEqual({ kind: "hidden" });
    expect(findingsSection({ data: empty, error: null }, { hideWhenEmpty: false })).toEqual({ kind: "empty" });
    expect(findingsSection({ data: { models: [sonnet], all }, error: null }, { hideWhenEmpty: true })).toEqual({ kind: "rows", all, models: [sonnet] });
  });

  it("hides the section when the load fails", () => {
    expect(findingsSection({ data: undefined, error: new Error("connection lost") })).toEqual({ kind: "hidden" });
  });

  it("hides the section when the RPC is missing", () => {
    // An older daemon has no taro.stats.findings handler: the call fails and no data ever arrives.
    expect(findingsSection({ data: undefined, error: new Error("No handler for RPC taro.stats.findings") })).toEqual({ kind: "hidden" });
  });

  it("hides the section while loading", () => {
    expect(findingsSection({ data: undefined, error: null })).toEqual({ kind: "hidden" });
  });
});

describe("cell text", () => {
  it("gives High per ticket to two decimals", () => {
    expect(highPerTicketText(sonnet)).toBe("0.25");
    expect(highPerTicketText({ ...sonnet, high: 1, tickets: 3 })).toBe("0.33");
    expect(highPerTicketText({ ...sonnet, high: 0, tickets: 0 })).toBe("0.00");
  });

  it("gives the phone's reviewed count", () => {
    expect(reviewedText(sonnet)).toBe("· 12 reviewed");
  });
});

describe("findingsFolded", () => {
  it("folds a desktop pane too narrow for the columns", () => {
    expect(findingsFolded(460, false)).toBe(true);
  });

  it("draws the columns on a desktop pane wide enough", () => {
    expect(findingsFolded(700, false)).toBe(false);
  });

  it("always folds on a phone", () => {
    expect(findingsFolded(700, true)).toBe(true);
  });

  it("draws the columns on a desktop before the pane is measured", () => {
    expect(findingsFolded(0, false)).toBe(false);
  });
});
