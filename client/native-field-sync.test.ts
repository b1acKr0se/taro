import { describe, expect, it } from "vitest";

import { createNativeFieldSync } from "./native-field-sync";

describe("createNativeFieldSync", () => {
  it("treats the owner handing back each typed text as an echo", () => {
    const sync = createNativeFieldSync("");
    let draft = "";
    const outside: boolean[] = [];
    for (const character of "x".repeat(2_000)) {
      draft += character;
      sync.typed(draft);
      outside.push(sync.outside(draft));
    }
    expect(outside.every((taken) => !taken)).toBe(true);
  });

  it("treats a late echo as an echo, and the newer one after it too", () => {
    const sync = createNativeFieldSync("");
    sync.typed("a");
    sync.typed("ab");
    sync.typed("abc");
    expect(sync.outside("a")).toBe(false);
    expect(sync.outside("abc")).toBe(false);
  });

  it("hands the field a draft cleared on send", () => {
    const sync = createNativeFieldSync("");
    sync.typed("Please rename it");
    expect(sync.outside("Please rename it")).toBe(false);
    expect(sync.outside("")).toBe(true);
  });

  it("hands the field a draft put back or switched while echoes were still pending", () => {
    const sync = createNativeFieldSync("");
    sync.typed("a");
    sync.typed("ab");
    expect(sync.outside("another agent's draft")).toBe(true);
    // The pending echoes went with the switch: the old typing is not taken for an echo later.
    expect(sync.outside("ab")).toBe(true);
  });

  it("takes the box emptied by typing as an echo", () => {
    const sync = createNativeFieldSync("hello");
    sync.typed("");
    expect(sync.outside("")).toBe(false);
  });

  it("changes nothing when the owner renders the same draft again", () => {
    const sync = createNativeFieldSync("kept draft");
    expect(sync.outside("kept draft")).toBe(false);
    expect(sync.outside("kept draft")).toBe(false);
  });

  it("keeps a bounded number of pending echoes when the owner never hands them back", () => {
    const sync = createNativeFieldSync("");
    let draft = "";
    for (const character of "y".repeat(500)) {
      draft += character;
      sync.typed(draft);
    }
    // The first texts were forgotten, so an echo of one of them counts as from outside.
    expect(sync.outside("y")).toBe(true);
  });

  it("still knows the newest pending echoes past the bound", () => {
    const sync = createNativeFieldSync("");
    let draft = "";
    for (const character of "y".repeat(500)) {
      draft += character;
      sync.typed(draft);
    }
    expect(sync.outside("y".repeat(460))).toBe(false);
  });
});
