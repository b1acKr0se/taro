import { describe, expect, it } from "vitest";

import { enterKeyAction, isStopKey } from "./keys";

describe("enterKeyAction (TR-102)", () => {
  it("sends on Enter when there is something to send", () => {
    expect(enterKeyAction({ key: "Enter" }, true)).toBe("send");
  });

  it("swallows Enter with nothing to send: a second Enter after a send leaves the cleared box empty, with no blank line", () => {
    expect(enterKeyAction({ key: "Enter" }, false)).toBe("nothing");
  });

  it("lets Shift+Enter, an input method's Enter and other keys type", () => {
    expect(enterKeyAction({ key: "Enter", shiftKey: true }, true)).toBeNull();
    expect(enterKeyAction({ key: "Enter", shiftKey: true }, false)).toBeNull();
    expect(enterKeyAction({ key: "Enter", isComposing: true }, true)).toBeNull();
    expect(enterKeyAction({ key: "Enter", keyCode: 229 }, false)).toBeNull();
    expect(enterKeyAction({ key: "a" }, true)).toBeNull();
  });
});

describe("isStopKey (TR-181)", () => {
  it("is Escape", () => {
    expect(isStopKey({ key: "Escape" })).toBe(true);
    expect(isStopKey({ key: "Escape", shiftKey: true })).toBe(true);
  });

  it("is not Escape cancelling an input method's word, nor any other key", () => {
    expect(isStopKey({ key: "Escape", isComposing: true })).toBe(false);
    expect(isStopKey({ key: "Escape", keyCode: 229 })).toBe(false);
    expect(isStopKey({ key: "Enter" })).toBe(false);
    expect(isStopKey({ key: "Esc" })).toBe(false);
    expect(isStopKey({ key: "" })).toBe(false);
  });
});
