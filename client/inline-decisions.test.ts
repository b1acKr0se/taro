import { describe, expect, it } from "vitest";

import type { StoredDecision } from "../shared/state";
import { offsetShowingRowEnd, placeDecisions, rowEndOnScreen } from "./inline-decisions";

function decision(id: string, parts: Partial<StoredDecision> = {}): StoredDecision {
  return {
    id,
    question: `${id}?`,
    why: "",
    blocking: false,
    options: [],
    recommended: "",
    reason: "",
    default: "",
    withdrawn: false,
    problems: [],
    key: `agent-1:${id}`,
    project: "notes-app",
    ticket: "NA-031",
    agentId: "agent-1",
    agentRole: "owner",
    agentTitle: null,
    askedAt: "2026-01-01T00:00:00Z",
    status: "open",
    answer: null,
    ...parts,
  };
}

const block = (id: string, extra = "") => `\`\`\`decision\nid: ${id}\nquestion: ${id}?\n${extra}\`\`\``;

describe("placeDecisions", () => {
  it("places nothing when nothing is open", () => {
    const places = placeDecisions([{ key: "r1", text: block("naming") }], []);
    expect(places.byRow.size).toBe(0);
    expect(places.unplaced).toEqual([]);
    expect(places.first).toBeNull();
  });

  it("draws each open decision under the message that asked it, in the order asked", () => {
    const naming = decision("naming");
    const colour = decision("colour");
    const places = placeDecisions(
      [
        { key: "r1", text: "Plain words." },
        { key: "r2", text: `Two questions.\n${block("colour")}\n${block("naming")}` },
      ],
      [naming, colour],
    );
    expect([...places.byRow.entries()]).toEqual([["r2", [colour, naming]]]);
    expect(places.unplaced).toEqual([]);
  });

  it("draws a decision asked again under its newest asking only", () => {
    const naming = decision("naming");
    const places = placeDecisions(
      [
        { key: "r1", text: block("naming") },
        { key: "r2", text: block("naming") },
      ],
      [naming],
    );
    expect([...places.byRow.keys()]).toEqual(["r2"]);
  });

  it("draws a decision repeated within one message once", () => {
    const naming = decision("naming");
    const places = placeDecisions([{ key: "r1", text: `${block("naming")}\n\n${block("naming")}` }], [naming]);
    expect(places.byRow.get("r1")).toEqual([naming]);
  });

  it("does not count a withdrawal as an asking", () => {
    const naming = decision("naming");
    const places = placeDecisions(
      [
        { key: "r1", text: block("naming") },
        { key: "r2", text: block("naming", "status: withdrawn\n") },
      ],
      [naming],
    );
    expect([...places.byRow.keys()]).toEqual(["r1"]);
  });

  it("puts a decision no loaded message asks at the end, and ignores settled blocks", () => {
    const naming = decision("naming");
    const places = placeDecisions([{ key: "r1", text: block("colour") }], [naming]);
    expect(places.byRow.size).toBe(0);
    expect(places.unplaced).toEqual([naming]);
  });

  it("brings the blocking decision into view first", () => {
    const naming = decision("naming");
    const approval = decision("scope-approval", { blocking: true });
    expect(placeDecisions([], [naming, approval]).first).toBe(approval);
  });
});

describe("rowEndOnScreen", () => {
  it("is on screen when the row's end is inside the viewport with room for a card", () => {
    expect(rowEndOnScreen(100, 200, 0, 600)).toBe(true);
    expect(rowEndOnScreen(100, 200, 200, 600)).toBe(true);
  });

  it("is off screen above and below", () => {
    expect(rowEndOnScreen(100, 200, 260, 600)).toBe(false);
    expect(rowEndOnScreen(1000, 200, 0, 600)).toBe(false);
    expect(rowEndOnScreen(560, 120, 0, 600)).toBe(false);
  });
});

describe("offsetShowingRowEnd", () => {
  it("puts the row's end at the bottom, never before the top", () => {
    expect(offsetShowingRowEnd(1000, 200, 600)).toBe(616);
    expect(offsetShowingRowEnd(0, 100, 600)).toBe(0);
  });
});
