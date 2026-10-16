import { describe, expect, it } from "vitest";

import type { StoredDecision } from "../shared/state";
import { cardFits, cardOnScreen, deliveryRowKey, offsetShowingCard, placeDecisions } from "./inline-decisions";

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
    turn: null,
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

describe("cardOnScreen", () => {
  it("is on screen when enough of the card shows", () => {
    expect(cardOnScreen(100, 200, 0, 600)).toBe(true);
    expect(cardOnScreen(100, 200, 200, 600)).toBe(true);
    // A card taller than the screen, shown from its top.
    expect(cardOnScreen(100, 1500, 92, 600)).toBe(true);
    // A card shorter than the slack, wholly shown.
    expect(cardOnScreen(100, 40, 0, 600)).toBe(true);
  });

  it("is off screen above and below, or with only a sliver showing", () => {
    expect(cardOnScreen(100, 200, 300, 600)).toBe(false);
    expect(cardOnScreen(1000, 200, 0, 600)).toBe(false);
    expect(cardOnScreen(560, 120, 0, 600)).toBe(false);
    expect(cardOnScreen(100, 200, 260, 600)).toBe(false);
  });
});

describe("offsetShowingCard", () => {
  it("puts a card that fits above the jump-to-end button, never before the top", () => {
    expect(offsetShowingCard(1000, 200, 600)).toBe(656);
    expect(offsetShowingCard(0, 100, 600)).toBe(0);
  });

  it("shows a card taller than the screen from its top", () => {
    expect(offsetShowingCard(1000, 900, 600)).toBe(992);
    expect(offsetShowingCard(1000, 537, 600)).toBe(992);
    expect(offsetShowingCard(1000, 536, 600)).toBe(1000 + 536 - 600 + 56);
  });
});

describe("cardFits", () => {
  it("fits a card with room for the jump button under it and a margin above", () => {
    expect(cardFits(536, 600)).toBe(true);
    expect(cardFits(537, 600)).toBe(false);
    expect(cardFits(0, 64)).toBe(true);
    expect(cardFits(0, 0)).toBe(false);
  });
});

describe("deliveryRowKey (TR-131)", () => {
  const delivered = (summary: string) => `Delivered.\n\n${summary}\n\ndone: PR https://example.test/o/r/pull/7 ready for acceptance`;

  it("is the newest message that ends on done:, so a second delivery takes the one card", () => {
    const rows = [
      { key: "r1", text: delivered("First go.") },
      { key: "r2", text: "Yes, the button keeps its label.\n\nwaiting: acceptance" },
      { key: "r3", text: delivered("Second go.") },
      { key: "r4", text: "Anything else?" },
    ];
    expect(deliveryRowKey(rows)).toBe("r3");
  });

  it("is the delivery when only later messages that are not deliveries follow it", () => {
    expect(deliveryRowKey([{ key: "r1", text: delivered("Done.") }, { key: "r2", text: "waiting: the user" }])).toBe("r1");
  });

  it("reads the status line however it is marked up, and not a done: earlier in the message", () => {
    expect(deliveryRowKey([{ key: "r1", text: "Shipped.\n\n**done**: ready" }])).toBe("r1");
    expect(deliveryRowKey([{ key: "r1", text: "The build is\ndone: earlier\none\ntwo\nthree\nwaiting: review" }])).toBeNull();
  });

  it("is null with no messages or no delivery loaded", () => {
    expect(deliveryRowKey([])).toBeNull();
    expect(deliveryRowKey([{ key: "r1", text: "Working on it.\n\nwaiting: implementer" }])).toBeNull();
  });
});
