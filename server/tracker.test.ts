import { describe, expect, it } from "vitest";

import { ticketIdInPath, withTaroStatuses } from "./tracker";
import { latestRecord } from "./tickets";
import { fill, withoutNotes } from "./package-files";
import { pluginPathIn } from "./cli";

describe("withTaroStatuses", () => {
  it("replaces Backlog's defaults with Taro's statuses, Done last", () => {
    const config = 'project_name: "x"\nstatuses: ["To Do", "In Progress", "Done"]\nlabels: []\n';
    const next = withTaroStatuses(config);
    expect(next).toContain(
      'statuses: ["Backlog","Planning","Ready","In Progress","Reviewing","Awaiting acceptance","Blocked","Cancelled","To Do","Done"]',
    );
    expect(next).toContain("labels: []");
  });

  it("leaves a config that already has Taro's statuses untouched", () => {
    const config =
      'statuses: ["Backlog","Planning","Ready","In Progress","Reviewing","Awaiting acceptance","Blocked","Cancelled","Done"]\n';
    expect(withTaroStatuses(config)).toBe(config);
  });

  it("refuses a config without an inline list", () => {
    expect(() => withTaroStatuses("statuses:\n  - Done\n")).toThrow(/inline statuses/);
  });
});

describe("ticketIdInPath", () => {
  it("reads the id from a task file name", () => {
    expect(ticketIdInPath("backlog/tasks/sh-012 - Fix-login.md")).toBe("SH-012");
    expect(ticketIdInPath("backlog/tasks/sh-001.02 - Child.md")).toBe("SH-001.02");
  });

  it("returns null for other files", () => {
    expect(ticketIdInPath("backlog/config.yml")).toBeNull();
  });
});

describe("latestRecord", () => {
  const notes = "DISPATCH-INTENT 2026 token\nEXECUTION 2026 agent a\nMILESTONE 2026 first\n\nmore detail\nMILESTONE 2026 second\nHANDOFF 2026 now";

  it("finds the most recent record of the given kinds", () => {
    expect(latestRecord(notes, ["MILESTONE"])).toBe("MILESTONE 2026 second");
    expect(latestRecord(notes, ["HANDOFF", "MILESTONE"])).toBe("HANDOFF 2026 now");
  });

  it("returns null when there is none", () => {
    expect(latestRecord(notes, ["FINAL"])).toBeNull();
    expect(latestRecord(null, ["FINAL"])).toBeNull();
  });
});

describe("templates", () => {
  it("drops notes and fills placeholders in one pass", () => {
    expect(withoutNotes("<!-- note -->\nHello {{name}}\n")).toBe("Hello {{name}}");
    expect(fill("Hi {{name}}, {{other}}", { name: "{{other}}" })).toBe("Hi {{other}}, {{other}}");
  });
});

describe("pluginPathIn", () => {
  it("finds the plugin's directory in paseo plugin ls output", () => {
    expect(pluginPathIn([{ id: "taro", path: "/x/taro" }, { id: "other", path: "/y" }], "taro")).toBe("/x/taro");
    expect(pluginPathIn([{ id: "other" }], "taro")).toBeNull();
    expect(pluginPathIn("nope", "taro")).toBeNull();
  });
});

import { sameQuestion } from "../shared/reports";

describe("sameQuestion", () => {
  const asked = { question: "Approve?", blocking: true, options: [{ label: "Approve", prompt: "Approve it", consequence: "" }] };
  it("matches an identical block and not a changed one", () => {
    expect(sameQuestion(asked, { ...asked, options: [{ label: "Approve", prompt: "Approve it", consequence: "different note" }] })).toBe(true);
    expect(sameQuestion(asked, { ...asked, question: "Approve the new scope?" })).toBe(false);
    expect(sameQuestion(asked, { ...asked, blocking: false })).toBe(false);
  });
});
