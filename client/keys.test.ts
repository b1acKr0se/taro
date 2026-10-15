import { describe, expect, it } from "vitest";

import { enterKeyAction } from "./keys";

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
