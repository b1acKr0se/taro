import { describe, expect, it } from "vitest";

import { composerNotice, heldMarkText } from "./composer-notice";

describe("composerNotice (TR-102)", () => {
  it("says nothing for a plain send", () => {
    expect(composerNotice(null, false)).toBeNull();
  });

  it("says Send holds the message while the agent compacts, as a message would cancel the compaction", () => {
    expect(composerNotice("compacting", false)?.text).toContain("compacting");
    expect(composerNotice("compacting", true)?.sendLabel).toBe("Hold until it has compacted");
  });

  it("says Send holds it while a replacing provider works", () => {
    expect(composerNotice("replaces", false)?.sendLabel).toBe("Hold until its step ends");
  });

  it("warns that a message turns down a pending permission or question, when it is sent at once", () => {
    expect(composerNotice(null, true)).toEqual({ text: "Sending a message now turns down the request above. Answer it first to keep it.", sendLabel: "Send and turn down the request" });
  });
});

describe("heldMarkText", () => {
  it("names what the message waits for", () => {
    expect(heldMarkText("compacting")).toBe("Held until it has compacted");
    expect(heldMarkText("replaces")).toBe("Held until its current step ends");
    // Once nothing holds it, it is about to go: the step it waited for ended.
    expect(heldMarkText(null)).toBe("Held until its current step ends");
  });
});
