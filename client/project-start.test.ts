import { describe, expect, it } from "vitest";

import { chooseProjectStart } from "../shared/contracts";
import { phoneTabFor, START_CHOICES, startInput, waitsForManager } from "./project-start";

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

  it("says the manager gets it later only for Brand new with no manager", () => {
    expect(waitsForManager("new", false)).toBe(true);
    expect(waitsForManager("new", true)).toBe(false);
    expect(waitsForManager("existing", false)).toBe(false);
    expect(waitsForManager(null, false)).toBe(false);
  });
});
