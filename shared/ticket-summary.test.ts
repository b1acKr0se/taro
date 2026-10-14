import { describe, expect, it } from "vitest";

import { descriptionParts, firstTextLine } from "./description";
import { finalSections } from "./final-summary";
import { LEGACY, LEGACY_DESCRIPTION, LEGACY_FINAL, SHORT, SHORT_DESCRIPTION, SHORT_FINAL } from "./ticket-fixtures.test-data";
import { foldList, planSummary, resultLine, ticketSections, ticketSummary, type TicketFacts } from "./ticket-summary";

const EMPTY: TicketFacts = {
  title: "Fix login redirect",
  status: "Backlog",
  description: null,
  plan: null,
  acceptanceCriteria: [],
  notes: null,
  finalSummary: null,
  children: [],
  evidence: null,
};

const APPROVAL = { id: "scope-approval", question: "Approve the plan for NA-056?", blocking: true };

describe("ticketSummary", () => {
  it("reads a new-format ticket: nothing needed once Done, the plan's Goal, the first What changed bullet", () => {
    expect(ticketSummary(SHORT, [])).toEqual({
      need: "nothing",
      needText: "nothing, Done",
      goal: "Add a project by picking one the host already knows, pre-filled; manual entry last.",
      result: "New project lists the host's git projects; picking one pre-fills the form and Create is one more tap.",
    });
  });

  it("falls back on a legacy ticket to the user's first sentence and FINAL's first sentence", () => {
    const summary = ticketSummary(LEGACY, []);
    expect(summary.goal).toBe("User feedback on New project: adding a project isn't quick today (fill in name, repository path, base branch and so on).");
    expect(summary.result).toBe("New project picks from the host's projects (option A, as tuned by the user).");
  });

  it("falls back to the title when there is no plan and no description", () => {
    expect(ticketSummary(EMPTY, [])).toEqual({ need: "nothing", needText: "nothing, Backlog", goal: "Fix login redirect", result: null });
    expect(ticketSummary({ ...EMPTY, description: "## Manager notes\n- only notes" }, []).goal).toBe("Fix login redirect");
  });

  it("asks to approve the plan while the scope approval waits", () => {
    const summary = ticketSummary({ ...SHORT, status: "Planning", finalSummary: null }, [APPROVAL]);
    expect(summary).toMatchObject({ need: "decision", needText: "Approve the plan", result: null });
  });

  it("shows another blocking question as asked, and counts the rest", () => {
    const decisions = [
      { id: "design", question: "Which design?", blocking: true },
      { id: "late", question: "Keep the old link?", blocking: true },
    ];
    expect(ticketSummary(EMPTY, decisions).needText).toBe("Which design? (+1 more)");
  });

  it("ignores a decision that does not block", () => {
    expect(ticketSummary(EMPTY, [{ id: "naming", question: "Rename it?", blocking: false }]).need).toBe("nothing");
  });

  it("asks for acceptance while the delivery waits", () => {
    expect(ticketSummary({ ...SHORT, status: "Awaiting acceptance" }, [])).toMatchObject({ need: "acceptance", needText: "Accept or request changes" });
  });
});

describe("resultLine", () => {
  it("is null without FINAL or with an empty one", () => {
    expect(resultLine(null)).toBeNull();
    expect(resultLine("  ")).toBeNull();
  });

  it("reads a FINAL without headings by its first sentence", () => {
    expect(resultLine("FINAL — Built it. Then reviewed it.")).toBe("Built it.");
  });
});

describe("ticketSections", () => {
  it("lists a delivered new-format ticket's sections in order, Result open", () => {
    expect(ticketSections(SHORT, [])).toEqual([
      { key: "plan", summary: "4 choices · Medium", open: false },
      { key: "result", summary: "New project lists the host's git projects; picking one pre-fills the form and Create is one more tap.", open: true },
      { key: "evidence", summary: "3 checks · 2 screenshots", open: false },
      { key: "milestones", summary: "user's words: \"I accept NA-056.\" Accepted revision 6c5464b. Merge: main 1c45fbe → 6c5464b, clean checkout.", open: false },
      { key: "description", summary: "Adding a project isn't quick today.", open: false },
      { key: "records", summary: "13 records", open: false },
    ]);
  });

  it("summarises a legacy ticket: the plan's first line, FINAL's first sentence", () => {
    const sections = ticketSections(LEGACY, []);
    expect(sections.map((section) => section.key)).toEqual(["plan", "result", "evidence", "milestones", "description", "records"]);
    expect(sections[0]?.summary).toBe("Design first (decision new-project-design), then:");
    expect(sections[1]?.summary).toBe("New project picks from the host's projects (option A, as tuned by the user).");
    expect(sections[4]?.summary).toBe("User feedback on New project: adding a project isn't quick today (fill in name, repository path, base branch and so on).");
  });

  it("leaves out every empty section", () => {
    expect(ticketSections(EMPTY, [])).toEqual([]);
    expect(ticketSections({ ...EMPTY, description: "  ", notes: "", plan: null }, [])).toEqual([]);
  });

  it("opens Plan while its scope approval waits, and in Planning, even before the plan is written", () => {
    expect(ticketSections(EMPTY, [APPROVAL])).toEqual([{ key: "plan", summary: "", open: true }]);
    expect(ticketSections({ ...SHORT, status: "Planning", finalSummary: null }, [])[0]).toMatchObject({ key: "plan", open: true });
  });

  it("puts a parent's children after Plan", () => {
    const parent = { ...SHORT, finalSummary: null, children: [{ status: "Done" }, { status: "In Progress" }] };
    expect(ticketSections(parent, []).slice(0, 2)).toEqual([
      { key: "plan", summary: "4 choices · Medium", open: false },
      { key: "children", summary: "2 children · 1 done", open: false },
    ]);
  });

  it("counts one record and calls notes without records raw", () => {
    expect(ticketSections({ ...EMPTY, notes: "MILESTONE 2026-10-14T08:15Z — oriented" }, [])).toEqual([
      { key: "milestones", summary: "oriented", open: false },
      { key: "records", summary: "1 record", open: false },
    ]);
    expect(ticketSections({ ...EMPTY, notes: "free text only" }, [])).toEqual([{ key: "records", summary: "raw notes", open: false }]);
  });

  it("names zero screenshots and one check", () => {
    expect(ticketSections({ ...EMPTY, evidence: { checks: [{}], screenshots: [] } }, [])).toEqual([{ key: "evidence", summary: "1 check · 0 screenshots", open: false }]);
  });
});

describe("planSummary", () => {
  it("counts the choices and keeps the Size's first word", () => {
    expect(planSummary("## Goal\nShip it.\n\n## Choices I made\n- One — why\n\n## Size\nLow: self-review.", [])).toBe("1 choice · Low");
  });

  it("falls back to the Goal for a template plan without choices or size", () => {
    expect(planSummary("## Goal\nShip **it**.", [])).toBe("Ship it.");
  });

  it("counts criteria met when there is no plan", () => {
    expect(planSummary(null, [{ checked: true }, { checked: false }])).toBe("1/2 criteria met");
    expect(planSummary(null, [])).toBe("");
  });
});

describe("descriptionParts", () => {
  it("splits the user's words from the Manager notes and counts their bullets", () => {
    const parts = descriptionParts(LEGACY_DESCRIPTION);
    expect(parts.userWords.startsWith("## Intent (the user's words)")).toBe(true);
    expect(parts.userWords).not.toContain("Manager notes");
    expect(parts.userWords.endsWith('before and after screenshots."')).toBe(true);
    expect(parts.managerNotes?.startsWith("- Related: NA-019")).toBe(true);
    expect(parts.managerNoteCount).toBe(4);
  });

  it("reads the brief template's Manager's notes heading", () => {
    expect(descriptionParts(SHORT_DESCRIPTION)).toMatchObject({ managerNoteCount: 4 });
    expect(descriptionParts("Do it.\n\n### MANAGER’S NOTES\n- a\n  - nested\n- b").managerNoteCount).toBe(2);
  });

  it("keeps a heading after the notes with the user's words", () => {
    const parts = descriptionParts("Words.\n\n## Manager notes\n- a\n\n## Later\nMore words.");
    expect(parts.userWords).toBe("Words.\n\n## Later\nMore words.");
    expect(parts.managerNotes).toBe("- a");
  });

  it("gives all of it as the user's words without Manager notes", () => {
    expect(descriptionParts("Just the ask.\n- one\n- two")).toEqual({ userWords: "Just the ask.\n- one\n- two", managerNotes: null, managerNoteCount: 0 });
  });

  it("is empty for a missing description, and ignores a heading inside code", () => {
    expect(descriptionParts(null)).toEqual({ userWords: "", managerNotes: null, managerNoteCount: 0 });
    expect(descriptionParts("```\n## Manager notes\n```").managerNotes).toBeNull();
  });
});

describe("firstTextLine", () => {
  it("skips headings, code and markup", () => {
    expect(firstTextLine("## Intent\n\n```\ncode\n```\n> - **Bold** start. Second.")).toBe("Bold start.");
    expect(firstTextLine("## Only a heading")).toBeNull();
    expect(firstTextLine(null)).toBeNull();
  });
});

describe("finalSections", () => {
  it("reads the template's three sections and keeps the revision line", () => {
    const sections = finalSections(SHORT_FINAL);
    expect(sections?.changed).toHaveLength(5);
    expect(sections?.verified).toEqual([
      "`npm run typecheck` exit 0; `npm test` 78 files, 938 passed.",
      "Throwaway daemon with scratch repos: every flow on desktop and phone.",
      "One review: 1 blocker, 2 should-fix; all fixed.",
    ]);
    expect(sections?.limitations).toHaveLength(2);
    expect(sections?.rest).toBe("new project picker\n\nRevision: 6c5464bf6ce9bc71fdb40b5f93badd137170ec42 · PR: none (local-only)");
  });

  it("is null for a FINAL without headings, and for none", () => {
    expect(finalSections(LEGACY_FINAL)).toBeNull();
    expect(finalSections(null)).toBeNull();
  });

  it("accepts bold and colon headings, wrapped bullets and plain lines", () => {
    const sections = finalSections("**What changed**\n- one\n  wrapped\nplain line\n\nHow it was verified:\n- tests\n\n**Limitations:**\n- none known\n\n## Other\nkept");
    expect(sections).toEqual({ changed: ["one wrapped", "plain line"], verified: ["tests"], limitations: ["none known"], rest: "## Other\nkept" });
  });

  it("keeps a revision line inside a section with the rest", () => {
    expect(finalSections("Revision: abc1234 · PR: none\n## What changed\n- a\nPR: https://example.com/pull/1")).toEqual({
      changed: ["a"],
      verified: [],
      limitations: [],
      rest: "Revision: abc1234 · PR: none\nPR: https://example.com/pull/1",
    });
  });

  it("leaves a code block with the rest", () => {
    expect(finalSections("## What changed\n- a\n```\n- not a bullet\n```")).toEqual({ changed: ["a"], verified: [], limitations: [], rest: "```\n- not a bullet\n```" });
  });
});

describe("foldList", () => {
  const items = (n: number) => Array.from({ length: n }, (_, index) => index);

  it("shows everything up to the limit", () => {
    expect(foldList(items(0), 3, false)).toEqual({ shown: [], hidden: 0 });
    expect(foldList(items(3), 3, false)).toEqual({ shown: [0, 1, 2], hidden: 0 });
    expect(foldList(items(4), 4, false)).toEqual({ shown: [0, 1, 2, 3], hidden: 0 });
  });

  it("folds past the limit until unfolded", () => {
    expect(foldList(items(4), 3, false)).toEqual({ shown: [0, 1, 2], hidden: 1 });
    expect(foldList(items(5), 4, false)).toEqual({ shown: [0, 1, 2, 3], hidden: 1 });
    expect(foldList(items(5), 4, true)).toEqual({ shown: [0, 1, 2, 3, 4], hidden: 0 });
  });
});
