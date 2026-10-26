import { describe, expect, it } from "vitest";

import { focusState } from "./chat-focus";

describe("focusState (TR-234)", () => {
  it("is ready on the tapped question's own card when two are open and drawn", () => {
    expect(focusState("manager:sync", ["manager:storage", "manager:sync"], new Set(["manager:storage", "manager:sync"]))).toEqual({ kind: "ready" });
  });

  it("waits while its card is not drawn yet, even when another is", () => {
    expect(focusState("manager:sync", ["manager:storage", "manager:sync"], new Set(["manager:storage"]))).toEqual({ kind: "waiting" });
    expect(focusState("manager:sync", ["manager:sync"], new Set())).toEqual({ kind: "waiting" });
  });

  it("is gone once the question is no longer open, even when its card is still drawn", () => {
    expect(focusState("manager:sync", ["manager:storage"], new Set(["manager:sync"]))).toEqual({ kind: "gone" });
    expect(focusState("manager:sync", [], new Set())).toEqual({ kind: "gone" });
  });
});
