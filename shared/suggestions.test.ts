import { describe, expect, it } from "vitest";

import { currentSuggestions, mentionedTicketIds, moreToTheRight, parseSuggestions, suggestionPills, withoutFixedActions, type SuggestionSend } from "./suggestions";

describe("parseSuggestions", () => {
  it("reads label :: prompt lines and skips notes", () => {
    const text = "<!-- - Not :: this -->\n- Accept SC-3 :: Accept SC-003\n* Review it :: Run a review on SC-004\nplain line\n";
    expect(parseSuggestions(text)).toEqual([
      { label: "Accept SC-3", prompt: "Accept SC-003" },
      { label: "Review it", prompt: "Run a review on SC-004" },
    ]);
  });
});

describe("mentionedTicketIds", () => {
  it("finds ids in any spelling and keeps children apart from parents", () => {
    expect([...mentionedTicketIds("Status of tr-5, TR-005.01 and (TR-012)")]).toEqual(["TR-5", "TR-5.1", "TR-12"]);
  });

  it("ignores ids inside longer words and things that are not ids", () => {
    expect([...mentionedTicketIds("2TR-005 TR-005a TR- 5 Catch up")]).toEqual([]);
  });

  it("reads a longer prefix as its own id, so it never matches a shorter one", () => {
    expect([...mentionedTicketIds("XTR-005")]).toEqual(["XTR-5"]);
  });
});

describe("currentSuggestions", () => {
  const writtenAt = Date.parse("2026-10-13T11:36:30Z");
  const ticket = (id: string, updatedAt: string | null) => ({ id, updatedAt });
  const relaunch = { label: "Relaunch TR-005", prompt: "Relaunch TR-005" };
  const catchUp = { label: "Catch up", prompt: "Catch up" };

  it("keeps suggestions that name no ticket", () => {
    expect(currentSuggestions([catchUp], writtenAt, [ticket("TR-005", "2026-10-13T12:00:00Z")])).toEqual([catchUp]);
  });

  it("keeps a suggestion naming a ticket the tracker does not have", () => {
    expect(currentSuggestions([relaunch], writtenAt, [ticket("TR-006", "2026-10-13T12:00:00Z")])).toEqual([relaunch]);
  });

  it("keeps a suggestion whose ticket changed before the write or in the same minute", () => {
    expect(currentSuggestions([relaunch], writtenAt, [ticket("TR-005", "2026-10-13T11:20:00Z")])).toEqual([relaunch]);
    expect(currentSuggestions([relaunch], writtenAt, [ticket("TR-005", "2026-10-13T11:36:00Z")])).toEqual([relaunch]);
    expect(currentSuggestions([relaunch], writtenAt, [ticket("TR-005", null)])).toEqual([relaunch]);
  });

  it("hides a suggestion whose ticket changed in a later minute", () => {
    expect(currentSuggestions([relaunch, catchUp], writtenAt, [ticket("TR-005", "2026-10-13T11:37:00Z")])).toEqual([catchUp]);
  });

  it("matches the id however the suggestion spells it, in its label or its prompt", () => {
    const spelled = { label: "Check on it", prompt: "What is tr-5 doing?" };
    expect(currentSuggestions([spelled], writtenAt, [ticket("TR-005", "2026-10-13T11:40:00Z")])).toEqual([]);
  });

  it("hides a suggestion naming several tickets when any of them changed", () => {
    const both = { label: "Compare", prompt: "Compare TR-002 and TR-006" };
    const tickets = [ticket("TR-002", "2026-10-13T11:00:00Z"), ticket("TR-006", "2026-10-13T11:50:00Z")];
    expect(currentSuggestions([both], writtenAt, tickets)).toEqual([]);
  });

  it("does not let a child's change retire a suggestion about its parent", () => {
    expect(currentSuggestions([relaunch], writtenAt, [ticket("TR-005.1", "2026-10-13T11:50:00Z")])).toEqual([relaunch]);
  });
});

describe("withoutFixedActions", () => {
  const suggestion = (label: string, prompt: string) => ({ label, prompt });

  it("drops a suggestion repeating Catch up or Compact, by its label or its prompt, in any case", () => {
    const suggestions = [
      suggestion("Catch up", "Catch me up on the project"),
      suggestion("What changed?", "catch up on everything"),
      suggestion("Get me up to speed", "Catch me up"),
      suggestion("COMPACT", "Compact your context"),
      suggestion("Free some context", "compact"),
    ];
    expect(withoutFixedActions(suggestions)).toEqual([]);
  });

  it("keeps a suggestion about a ticket, since it is another action than the button", () => {
    const suggestions = [suggestion("Compact DM-012", "Compact the owner of DM-012"), suggestion("Catch up on DM-4", "Catch me up on DM-004")];
    expect(withoutFixedActions(suggestions)).toEqual(suggestions);
  });

  it("keeps words that only contain or mention the actions", () => {
    const suggestions = [
      suggestion("Compaction stats", "How many compactions this week?"),
      suggestion("Plan a catch-up page", "File a ticket to catch up readers"),
      suggestion("Status of DM-002", "What is the status of DM-002?"),
    ];
    expect(withoutFixedActions(suggestions)).toEqual(suggestions);
  });

  it("keeps the order of what it keeps, and an empty list stays empty", () => {
    expect(withoutFixedActions([suggestion("A", "a"), suggestion("Catch up", "Catch me up"), suggestion("B", "b")])).toEqual([suggestion("A", "a"), suggestion("B", "b")]);
    expect(withoutFixedActions([])).toEqual([]);
  });
});

describe("suggestionPills", () => {
  const a = { label: "A", prompt: "Do A" };
  const b = { label: "B", prompt: "Do B" };
  const c = { label: "C", prompt: "Do C" };

  it("draws the board's suggestions idle when nothing was sent", () => {
    expect(suggestionPills([a, b], [])).toEqual([
      { suggestion: a, state: "idle" },
      { suggestion: b, state: "idle" },
    ]);
    expect(suggestionPills([], [])).toEqual([]);
  });

  it("gives each suggestion its own send state", () => {
    const sends: SuggestionSend[] = [
      { suggestion: a, state: "sending", index: 0 },
      { suggestion: c, state: "failed", index: 2 },
    ];
    expect(suggestionPills([a, b, c], sends).map((pill) => pill.state)).toEqual(["sending", "idle", "failed"]);
  });

  it("carries a failure's reason to its pill", () => {
    const sends: SuggestionSend[] = [{ suggestion: a, state: "failed", index: 0, reason: "No manager yet." }];
    expect(suggestionPills([a], sends)).toEqual([{ suggestion: a, state: "failed", reason: "No manager yet." }]);
  });

  it("matches by label and prompt together", () => {
    const sends: SuggestionSend[] = [{ suggestion: { label: "A", prompt: "Something else" }, state: "failed", index: 0 }];
    expect(suggestionPills([a], sends)).toEqual([{ suggestion: a, state: "idle" }]);
  });

  it("keeps a pill being sent or just sent where it was after the board drops it", () => {
    const sends: SuggestionSend[] = [
      { suggestion: b, state: "sent", index: 1 },
      { suggestion: a, state: "sending", index: 0 },
    ];
    expect(suggestionPills([c], sends)).toEqual([
      { suggestion: a, state: "sending" },
      { suggestion: b, state: "sent" },
      { suggestion: c, state: "idle" },
    ]);
  });

  it("puts a dropped pill last when the row has grown shorter than its place", () => {
    expect(suggestionPills([a], [{ suggestion: c, state: "sent", index: 5 }]).map((pill) => pill.suggestion.label)).toEqual(["A", "C"]);
    expect(suggestionPills([], [{ suggestion: c, state: "sent", index: 5 }])).toEqual([{ suggestion: c, state: "sent" }]);
  });

  it("forgets a failed pill the manager no longer suggests", () => {
    expect(suggestionPills([a], [{ suggestion: b, state: "failed", index: 1 }])).toEqual([{ suggestion: a, state: "idle" }]);
  });
});

describe("moreToTheRight", () => {
  it("is true while the row runs past the right edge", () => {
    expect(moreToTheRight(0, 300, 500)).toBe(true);
    expect(moreToTheRight(150, 300, 500)).toBe(true);
  });

  it("is false at the end, when everything fits, before layout and for a pixel of rounding", () => {
    expect(moreToTheRight(200, 300, 500)).toBe(false);
    expect(moreToTheRight(0, 300, 280)).toBe(false);
    expect(moreToTheRight(0, 0, 0)).toBe(false);
    expect(moreToTheRight(199.5, 300, 500)).toBe(false);
  });
});
