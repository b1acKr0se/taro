import { describe, expect, it } from "vitest";

import { currentSuggestions, mentionedTicketIds, parseSuggestions } from "./suggestions";

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
