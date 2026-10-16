import { describe, expect, it } from "vitest";

import { parsePlan, type ParsedPlan } from "./plan";
import { lastPlanAnswer, markedAgainst, noPlanChanges, planChanges, planChangesCaption } from "./plan-changes";

const FIRST = `## Goal
Notes sort by the date they were last edited.

## Choices I made
- Newest first — what you open most often is on top
- Ties keep the order they were created in — stable

## What you'll see
- The notes list sorted by edit date
- A small "edited" time on each row

## Out of scope
- Sorting by title

## How I'll prove it
- Screenshot of the sorted list (phone, desktop)

## Size
Low: self-review; about 1 hour.
`;

function plan(markdown: string): ParsedPlan {
  const parsed = parsePlan(markdown);
  if (parsed === null) throw new Error("not a template plan");
  return parsed;
}

const answer = (at: string, rest: string) => `ANSWER ${at} — scope-approval: "Approve the plan for NA-12?" → ${rest} (the user, from the Taro screen)`;

describe("lastPlanAnswer", () => {
  it("is null before the user answered any plan", () => {
    expect(lastPlanAnswer(null)).toBeNull();
    expect(lastPlanAnswer("")).toBeNull();
    expect(lastPlanAnswer("MILESTONE 2026-10-16T02:41Z — plan written\n\nANSWER 2026-10-16T02:42:00.000Z — fee-storage: \"Store fees?\" → Per trade")).toBeNull();
  });

  it("reads Approve as approved, typed words as changes requested and another option as answered", () => {
    expect(lastPlanAnswer(answer("2026-10-16T02:41:28.627Z", 'Approve ("Approve")'))).toEqual({
      line: answer("2026-10-16T02:41:28.627Z", 'Approve ("Approve")'),
      at: "2026-10-16T02:41:28.627Z",
      kind: "approved",
    });
    expect(lastPlanAnswer(answer("2026-10-16T02:41:28.627Z", 'Request changes ("add tags")'))?.kind).toBe("changes requested");
    expect(lastPlanAnswer(answer("2026-10-16T02:41:28.627Z", '"approve, but skip the review"'))?.kind).toBe("changes requested");
    expect(lastPlanAnswer(answer("2026-10-16T02:41:28.627Z", 'Split into children ("Split into children")'))?.kind).toBe("answered");
  });

  it("takes the newest record, an owner's APPROVAL of words included", () => {
    const notes = [
      answer("2026-10-16T02:41:28.627Z", 'Approve ("Approve")'),
      "APPROVAL 2026-10-16T02:41Z — user picked Approve (decision scope-approval): \"Approve\"",
      "CHANGES-REQUESTED 2026-10-16T02:54Z — the user: \"Add tags\"",
      answer("2026-10-16T02:58:00.000Z", 'Request changes ("tags too")'),
      "MILESTONE 2026-10-16T02:59Z — plan updated",
    ].join("\n\n");
    expect(lastPlanAnswer(notes)).toMatchObject({ at: "2026-10-16T02:58:00.000Z", kind: "changes requested" });
    const words = `${notes}\n\nAPPROVAL 2026-10-16T03:01Z — user: "approve, but skip the review"`;
    expect(lastPlanAnswer(words)).toEqual({ line: 'APPROVAL 2026-10-16T03:01Z — user: "approve, but skip the review"', at: "2026-10-16T03:01Z", kind: "approved" });
  });

  it("ignores records quoted mid-line, as CORRECTION records quote them", () => {
    expect(lastPlanAnswer("CORRECTION 2026-10-16T03:00Z — wrong: APPROVAL 2026-10-16T02:41Z — x")).toBeNull();
  });
});

describe("planChanges", () => {
  it("marks nothing for the same plan, whatever its spacing", () => {
    const changes = planChanges(plan(FIRST), plan(FIRST.replace("Newest first —", "Newest   first —").replace(/\n/g, "\n\n")));
    expect(changes.any).toBe(false);
    expect(changes.goal).toBe(false);
    expect(changes.choices).toEqual([false, false]);
  });

  it("marks nothing without an earlier plan in the template's shape", () => {
    const current = plan(FIRST);
    expect(planChanges(null, current)).toEqual(noPlanChanges(current));
    expect(noPlanChanges(current).sections.map((section) => section.items.length)).toEqual([0, 2, 2, 1, 1, 0]);
  });

  it("marks a reworded choice and an added one, not the ones kept or moved", () => {
    const next = FIRST.replace(
      "- Newest first — what you open most often is on top\n- Ties keep the order they were created in — stable",
      "- Ties keep the order they were created in — stable\n- Newest first — what you open most often stays on top\n- Pinned notes stay above the rest — you asked for it",
    );
    const changes = planChanges(plan(FIRST), plan(next));
    expect(changes.choices).toEqual([false, true, true]);
    expect(changes.sections[1]?.items).toEqual([false, true, true]);
    expect(changes.goal).toBe(false);
    expect(changes.size).toBe(false);
    expect(changes.any).toBe(true);
  });

  it("marks a changed Goal and Size line, written as prose or as a bullet", () => {
    const next = FIRST.replace("Notes sort by the date they were last edited.", "Notes sort by edit date, pinned ones first.").replace("Low: self-review; about 1 hour.", "- Medium: one review; about 2 hours.");
    const changes = planChanges(plan(FIRST), plan(next));
    expect(changes.goal).toBe(true);
    expect(changes.sections[0]).toEqual({ prose: true, items: [] });
    expect(changes.size).toBe(true);
    expect(changes.sections[5]).toEqual({ prose: false, items: [true] });
  });

  it("does not mark Size when only how it is written changed", () => {
    const changes = planChanges(plan(FIRST), plan(FIRST.replace("Low: self-review; about 1 hour.", "- Low: self-review; about 1 hour.")));
    expect(changes.size).toBe(false);
    expect(changes.sections[5]).toEqual({ prose: false, items: [false] });
  });

  it("marks every bullet of a section the earlier plan lacked, and matches unknown sections by heading", () => {
    const before = FIRST.replace("## Size", "## Risks\n- Old notes have no edit date\n\n## Size");
    const next = before.replace("## Out of scope\n- Sorting by title\n\n", "").replace("## Risks", "## risks").replace("## Size", "## Follow-ups\n- Sort by title later\n\n## Size");
    const changes = planChanges(plan(before), plan(next));
    const headings = plan(next).sections.map((section) => section.heading);
    expect(changes.sections[headings.indexOf("risks")]?.items).toEqual([false]);
    expect(changes.sections[headings.indexOf("Follow-ups")]?.items).toEqual([true]);
    const added = planChanges(plan(FIRST.replace("## Out of scope\n- Sorting by title\n\n", "")), plan(FIRST));
    expect(added.sections[plan(FIRST).sections.findIndex((section) => section.key === "outOfScope")]?.items).toEqual([true]);
  });

  it("marks changed prose in a section but not prose that stayed or is empty", () => {
    const before = FIRST.replace("## What you'll see\n", "## What you'll see\nOn every screen with notes.\n");
    expect(planChanges(plan(before), plan(before)).sections[2]?.prose).toBe(false);
    expect(planChanges(plan(before), plan(before.replace("On every screen", "On the list screen"))).sections[2]?.prose).toBe(true);
    expect(planChanges(plan(before), plan(FIRST)).sections[2]?.prose).toBe(false);
  });

  it("does not mark a removed bullet or section anywhere", () => {
    const next = FIRST.replace("- A small \"edited\" time on each row\n", "");
    expect(planChanges(plan(FIRST), plan(next)).any).toBe(false);
  });
});

describe("planChangesCaption", () => {
  it("says since which plan, with its time when readable", () => {
    expect(planChangesCaption("approved", "02:41")).toBe("Green: new or changed since the plan you approved at 02:41");
    expect(planChangesCaption("changes requested", "02:54")).toBe("Green: new or changed since the plan you asked to change at 02:54");
    expect(planChangesCaption("answered", null)).toBe("Green: new or changed since the plan you answered");
  });
});

describe("markedAgainst", () => {
  it("marks against the earlier plan only while a plan is asked again", () => {
    const previous = { plan: FIRST, at: "2026-10-16T02:41Z", kind: "approved" as const };
    expect(markedAgainst(previous, true)).toBe(previous);
    // Approved, then edited inside its scope: the Ticket tab's plan looks as before.
    expect(markedAgainst(previous, false)).toBeNull();
    expect(markedAgainst(undefined, true)).toBeNull();
    expect(markedAgainst(null, false)).toBeNull();
  });
});

describe("planChangesCaption with a day", () => {
  it("names the day only when the answer was not today", () => {
    expect(planChangesCaption("approved", "02:41", "Today")).toBe("Green: new or changed since the plan you approved at 02:41");
    expect(planChangesCaption("approved", "02:41", "Yesterday")).toBe("Green: new or changed since the plan you approved yesterday at 02:41");
    expect(planChangesCaption("changes requested", "02:54", "Oct 12")).toBe("Green: new or changed since the plan you asked to change on Oct 12 at 02:54");
    expect(planChangesCaption("answered", null, null)).toBe("Green: new or changed since the plan you answered");
  });
});
