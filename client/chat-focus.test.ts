import { describe, expect, it } from "vitest";

import { focusState } from "./chat-focus";

const layout = { x: 0, y: 400, width: 300, height: 120 };

describe("focusState (TR-234)", () => {
  it("is ready on the tapped question's own card when two are open", () => {
    const layouts = new Map([
      ["manager:storage", { ...layout, y: 100 }],
      ["manager:sync", layout],
    ]);
    expect(focusState("manager:sync", ["manager:storage", "manager:sync"], layouts)).toEqual({ kind: "ready", layout });
  });

  it("waits while the card is not laid out yet", () => {
    expect(focusState("manager:sync", ["manager:sync"], new Map())).toEqual({ kind: "waiting" });
  });

  it("is gone once the question is no longer open, even when a layout is left", () => {
    expect(focusState("manager:sync", ["manager:storage"], new Map([["manager:sync", layout]]))).toEqual({ kind: "gone" });
    expect(focusState("manager:sync", [], new Map())).toEqual({ kind: "gone" });
  });
});
