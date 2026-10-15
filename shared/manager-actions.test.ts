import { describe, expect, it } from "vitest";

import { MANAGER_ACTION_LABELS, managerPaneNotice, managerSettingsActions } from "./manager-actions";

describe("managerSettingsActions", () => {
  it("offers only Start manager when there is none", () => {
    expect(managerSettingsActions(null).kinds).toEqual(["launch"]);
  });

  it("offers Resume first and a fresh start, saying the old conversation is archived, not deleted", () => {
    for (const status of ["idle", "error", "running"]) {
      const { kinds, description } = managerSettingsActions({ status });
      expect(kinds).toEqual(["resume", "fresh"]);
      expect(description).toContain("its conversation kept");
      expect(description).toContain("archived, not deleted");
    }
    expect(kinds()).toEqual(["Resume manager", "Start a fresh manager"]);
  });

  it("says a crashed manager stopped with an error", () => {
    expect(managerSettingsActions({ status: "error" }).description).toMatch(/^The manager stopped with an error\. /);
    expect(managerSettingsActions({ status: "idle" }).description).not.toContain("error");
  });
});

describe("managerPaneNotice", () => {
  it("points a crashed manager to Resume, and says nothing otherwise", () => {
    expect(managerPaneNotice({ status: "error" })).toContain("Resume manager");
    expect(managerPaneNotice({ status: "idle" })).toBeNull();
    expect(managerPaneNotice({ status: "running" })).toBeNull();
    expect(managerPaneNotice(null)).toBeNull();
  });
});

function kinds(): string[] {
  return managerSettingsActions({ status: "error" }).kinds.map((kind) => MANAGER_ACTION_LABELS[kind]);
}
