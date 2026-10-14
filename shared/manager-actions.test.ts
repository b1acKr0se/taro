import { describe, expect, it } from "vitest";

import { MANAGER_ACTION_LABELS, managerPaneNotice, managerSettingsActions } from "./manager-actions";

describe("managerSettingsActions", () => {
  it("offers only Start Manager when there is none", () => {
    expect(managerSettingsActions(null).kinds).toEqual(["launch"]);
  });

  it("offers Resume first and a fresh start, saying the old conversation is archived, not deleted", () => {
    for (const status of ["idle", "error", "running"]) {
      const { kinds, description } = managerSettingsActions({ status });
      expect(kinds).toEqual(["resume", "fresh"]);
      expect(description).toContain("its conversation kept");
      expect(description).toContain("archived, not deleted");
    }
    expect(kinds()).toEqual(["Resume Manager", "Start a fresh Manager"]);
  });

  it("says a crashed Manager stopped with an error", () => {
    expect(managerSettingsActions({ status: "error" }).description).toMatch(/^The Manager stopped with an error\. /);
    expect(managerSettingsActions({ status: "idle" }).description).not.toContain("error");
  });
});

describe("managerPaneNotice", () => {
  it("points a crashed Manager to Resume, and says nothing otherwise", () => {
    expect(managerPaneNotice({ status: "error" })).toContain("Resume Manager");
    expect(managerPaneNotice({ status: "idle" })).toBeNull();
    expect(managerPaneNotice({ status: "running" })).toBeNull();
    expect(managerPaneNotice(null)).toBeNull();
  });
});

function kinds(): string[] {
  return managerSettingsActions({ status: "error" }).kinds.map((kind) => MANAGER_ACTION_LABELS[kind]);
}
