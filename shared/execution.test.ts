import { describe, expect, it } from "vitest";

import { executionMachine, executionWorkspace, noteRecords } from "./execution";

const managerRecord = "EXECUTION 2026-10-13T11:22Z — owner agent d86f, workspace wks_67ddffd9312aa95a, machine devbox, worktree /w/tr-001";
// As a Haiku owner wrote it on the throwaway daemon: the relaunch could not find its workspace (TR-001).
const ownerRecord = "EXECUTION 2026-10-13T11:24Z — owner agent: e2d7; workspace: wks_aa0a7ad239386299; machine: devbox; worktree: /tmp/sc-001";

describe("executionWorkspace", () => {
  it("reads the workspace however the record spells it", () => {
    expect(executionWorkspace(managerRecord)).toBe("wks_67ddffd9312aa95a");
    expect(executionWorkspace(ownerRecord)).toBe("wks_aa0a7ad239386299");
    expect(executionWorkspace("EXECUTION x — workspace=wks_abc1")).toBe("wks_abc1");
    expect(executionWorkspace("EXECUTION x — workspace id `wks_abc2`")).toBe("wks_abc2");
    expect(executionWorkspace("EXECUTION x — **Workspace:** wks_abc3")).toBe("wks_abc3");
    expect(executionWorkspace("EXECUTION x — workspaceId: wks_abc4")).toBe("wks_abc4");
  });

  it("takes the newest record that names a workspace", () => {
    const notes = [managerRecord, "MILESTONE m — built", "EXECUTION later — owner agent a073 (took over)", "MILESTONE n — more"].join("\n\n");
    expect(executionWorkspace(notes)).toBe("wks_67ddffd9312aa95a");
    expect(executionWorkspace(`${notes}\n\n${ownerRecord}`)).toBe("wks_aa0a7ad239386299");
  });

  it("ignores workspaces named outside EXECUTION records", () => {
    expect(executionWorkspace("MILESTONE m — workspace wks_nothere")).toBeNull();
    expect(executionWorkspace("EXECUTION x — owner agent a, no workspace yet")).toBeNull();
    expect(executionWorkspace("")).toBeNull();
    expect(executionWorkspace(null)).toBeNull();
  });
});

describe("executionMachine", () => {
  it("reads machine or host", () => {
    expect(executionMachine(managerRecord)).toBe("devbox");
    expect(executionMachine(ownerRecord)).toBe("devbox");
    expect(executionMachine("EXECUTION x — host: laptop.local")).toBe("laptop.local");
    expect(executionMachine("EXECUTION x — hostname=build-1")).toBe("build-1");
    expect(executionMachine("EXECUTION x — worktree /w, machine devbox.")).toBe("devbox");
    expect(executionMachine("EXECUTION x — machine `laptop.local`.")).toBe("laptop.local");
  });

  it("takes the newest record that names one, and nothing otherwise", () => {
    expect(executionMachine(`${managerRecord}\n\nEXECUTION y — machine: other-box`)).toBe("other-box");
    expect(executionMachine("EXECUTION y — owner agent a")).toBeNull();
    expect(executionMachine(null)).toBeNull();
  });
});

describe("noteRecords", () => {
  it("splits on record names and drops empty blocks", () => {
    expect(noteRecords("EXECUTION a\nline two\n\nMILESTONE b")).toEqual(["EXECUTION a\nline two", "MILESTONE b"]);
    expect(noteRecords(null)).toEqual([]);
  });
});
