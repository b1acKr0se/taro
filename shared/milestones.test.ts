import { describe, expect, it } from "vitest";

import { kindLabel, latestMilestone, ticketMilestones } from "./milestones";

describe("ticketMilestones", () => {
  it("returns nothing for null and empty notes", () => {
    expect(ticketMilestones(null)).toEqual([]);
    expect(ticketMilestones("")).toEqual([]);
  });

  it("ignores text before the first record", () => {
    const notes = "some preamble\nmore words\nMILESTONE 2026-10-13T14:02Z — tests green";
    expect(ticketMilestones(notes)).toEqual([{ kind: "MILESTONE", time: "2026-10-13T14:02Z", text: "tests green" }]);
  });

  it("accepts an em dash, a hyphen and a colon", () => {
    const notes = "MILESTONE 2026-10-13T14:02Z — a\nREVIEW 2026-10-13T14:03Z - b\nFINAL 2026-10-13T14:04Z: c";
    expect(ticketMilestones(notes).map((milestone) => milestone.text)).toEqual(["a", "b", "c"]);
  });

  it("allows a missing time", () => {
    expect(ticketMilestones("APPROVAL — go ahead")).toEqual([{ kind: "APPROVAL", time: null, text: "go ahead" }]);
    expect(ticketMilestones("ANSWER: yes")).toEqual([{ kind: "ANSWER", time: null, text: "yes" }]);
  });

  it("reads seconds and milliseconds", () => {
    const notes = "EXECUTION 2026-10-13T14:02:05Z — a\nHANDOFF 2026-10-13T14:02:05.123Z — b";
    expect(ticketMilestones(notes).map((milestone) => milestone.time)).toEqual(["2026-10-13T14:02:05Z", "2026-10-13T14:02:05.123Z"]);
  });

  it("reads the plugin's Accept hand-off as one record, its label in plain words", () => {
    const notes = "ACCEPT-HANDOFF — Fresh owner, idle 9 h: f8078033 took over. The plugin stopped: x";
    expect(ticketMilestones(notes)).toEqual([{ kind: "ACCEPT-HANDOFF", time: null, text: "Fresh owner, idle 9 h: f8078033 took over. The plugin stopped: x" }]);
    expect(kindLabel("ACCEPT-HANDOFF")).toBe("Accept handoff");
  });

  it("collapses a multi-line body", () => {
    const notes = "MILESTONE 2026-10-13T14:02Z — first line\n  second   line\n\n  third";
    expect(ticketMilestones(notes)[0]?.text).toBe("first line second line third");
  });

  it("keeps a long record whole", () => {
    expect(ticketMilestones(`MILESTONE — ${"a".repeat(500)}`)[0]?.text).toBe("a".repeat(500));
  });

  it("keeps unknown kinds and note order", () => {
    const notes = "DISPATCH-INTENT 2026-10-13T10:00Z — x\nWHATEVER 2026-10-13T11:00Z — y\nRECOVERY 2026-10-13T12:00Z — z";
    expect(ticketMilestones(notes).map((milestone) => milestone.kind)).toEqual(["DISPATCH-INTENT", "WHATEVER", "RECOVERY"]);
  });

  it("joins a body line that opens with capitals to its record", () => {
    const notes = "MILESTONE 2026-10-13T14:02Z — tests green\nREADME updated, API docs next\nAPI: done\nREVIEW — r";
    expect(ticketMilestones(notes)).toEqual([
      { kind: "MILESTONE", time: "2026-10-13T14:02Z", text: "tests green README updated, API docs next API: done" },
      { kind: "REVIEW", time: null, text: "r" },
    ]);
  });

  it("keeps a timeless unknown name as a record when nothing comes before it", () => {
    expect(ticketMilestones("NOTE — first\nMILESTONE — m").map((milestone) => milestone.kind)).toEqual(["NOTE", "MILESTONE"]);
  });
});

describe("latestMilestone", () => {
  it("is null without a MILESTONE record", () => {
    expect(latestMilestone(null)).toBeNull();
    expect(latestMilestone("EXECUTION 2026-10-13T14:02Z — started")).toBeNull();
  });

  it("picks the last MILESTONE", () => {
    const notes = "MILESTONE 2026-10-13T10:00Z — one\nREVIEW 2026-10-13T11:00Z — r\nMILESTONE 2026-10-13T12:00Z — two\nEXECUTION — e";
    expect(latestMilestone(notes)).toEqual({ kind: "MILESTONE", time: "2026-10-13T12:00Z", text: "two" });
  });

  it("cuts the latest at 200 characters with an ellipsis", () => {
    const exact = latestMilestone(`MILESTONE — ${"a".repeat(200)}`)?.text;
    const over = latestMilestone(`MILESTONE — ${"a".repeat(201)}`)?.text;
    expect(exact).toBe("a".repeat(200));
    expect(over).toBe(`${"a".repeat(199)}…`);
    expect(over).toHaveLength(200);
  });

  it("keeps a continuation line that opens with capitals", () => {
    expect(latestMilestone("MILESTONE 2026-10-13T10:00Z — built\nCSS tidied")?.text).toBe("built CSS tidied");
  });
});

describe("kindLabel", () => {
  it("calls a PAUSE-REQUESTED record by the button's name since TR-166", () => {
    expect(kindLabel("PAUSE-REQUESTED")).toBe("Park requested");
  });

  it("writes a record kind in plain words", () => {
    expect(kindLabel("MILESTONE")).toBe("Milestone");
    expect(kindLabel("DISPATCH-INTENT")).toBe("Dispatch intent");
    expect(kindLabel("")).toBe("");
  });
});

describe("the Taro 207 records", () => {
  it("RISKS keeps its risk lines", () => {
    const notes = "MILESTONE 2026-10-20T09:00Z — plan approved\nRISKS — three ways this breaks\nrisk: input — an empty file\nrisk: concurrency — two writers\nMILESTONE 2026-10-20T10:05Z — built";
    expect(ticketMilestones(notes).map((record) => record.kind)).toEqual(["MILESTONE", "RISKS", "MILESTONE"]);
    expect(ticketMilestones(notes)[1]?.text).toContain("risk: input — an empty file risk: concurrency — two writers");
  });

  it("RULING and HANDS-OFF are records without a time too", () => {
    const notes = "MILESTONE 2026-10-20T10:00Z — a\nRULING — use X — simpler — redo\nHANDS-OFF — the user: \"you decide\"";
    expect(ticketMilestones(notes).map((record) => record.kind)).toEqual(["MILESTONE", "RULING", "HANDS-OFF"]);
  });

  it("HANDS-OFF reads Hands off", () => {
    expect(kindLabel("HANDS-OFF")).toBe("Hands off");
    expect(kindLabel("RISKS")).toBe("Risks");
  });
});
