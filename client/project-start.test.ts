import { describe, expect, it } from "vitest";

import { chooseProjectStart } from "../shared/contracts";
import { phoneTabFor, START_CHOICES, startInput, startNotice, TOLD_AT_START, waitsForManager } from "./project-start";

describe("the start question", () => {
  it("each choice sends its input", () => {
    expect(START_CHOICES.map((choice) => startInput("notes-app", choice.choice))).toEqual([
      { project: "notes-app", choice: "new" },
      { project: "notes-app", choice: "existing" },
    ]);
    for (const choice of START_CHOICES) expect(() => chooseProjectStart.input.parse(startInput("notes-app", choice.choice))).not.toThrow();
    expect(START_CHOICES.map((choice) => choice.title)).toEqual(["Brand new project", "Existing project"]);
  });

  it("phone opens on Manager while asking", () => {
    for (const tab of ["manager", "inbox", "board", "stats"] as const) {
      expect(phoneTabFor(true, tab)).toBe("manager");
      expect(phoneTabFor(false, tab)).toBe(tab);
    }
  });

  it("says the manager gets it later only while that is true: Brand new, no ticket, no manager", () => {
    expect(waitsForManager(true, false)).toBe(true);
    expect(waitsForManager(true, true)).toBe(false);
    // Existing chosen, nothing chosen, or a ticket already filed: the summary's pending fact is false.
    expect(waitsForManager(false, false)).toBe(false);
  });

  it("keeps the answer's words when the manager was not told", () => {
    expect(startNotice("new", { told: true })).toBeNull();
    expect(startNotice("existing", { told: false })).toBeNull();
    expect(startNotice("new", { told: false, reason: "gone", message: "The manager could not be told (gone)." })).toBe("The manager could not be told (gone).");
    expect(startNotice("new", { told: false, reason: "gone" })).toBe("gone");
    // No manager ran: the pane's pending line says it, and the manager that starts gets the message.
    expect(startNotice("new", { told: false, reason: "no manager running", message: TOLD_AT_START })).toBeNull();
  });
});
