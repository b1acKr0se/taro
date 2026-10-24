import { describe, expect, it } from "vitest";

import { refusedMessage, sendUnlessRefused, UNLISTED_COMMANDS } from "./refused-commands";

describe("refusedMessage", () => {
  it("refuses /clear as the message's first word, in any case, with words after it or spaces before", () => {
    for (const text of ["/clear", "/clear now", "  /clear", "/clear\nplease", "/CLEAR", "/Clear "]) {
      expect(refusedMessage(text), text).toBe("/clear is not available in this plugin.");
    }
  });

  it("refuses Claude's other names for it", () => {
    expect(refusedMessage("/reset")).toBe("/reset is not available in this plugin.");
    expect(refusedMessage("/new")).toBe("/new is not available in this plugin.");
  });

  it("sends everything else: other commands, longer names, /clear inside a sentence, plain text, empty", () => {
    for (const text of ["/compact", "/clearly", "/clear-cache", "/newline", "don't /clear yet", "clear the cache", "/ clear", "", "   ", "/", "/exit"]) {
      expect(refusedMessage(text), text).toBeNull();
    }
  });
});

describe("UNLISTED_COMMANDS", () => {
  it("keeps /clear, its other names and /exit out of the list", () => {
    expect([...UNLISTED_COMMANDS].sort()).toEqual(["clear", "exit", "new", "reset"]);
  });
});

describe("sendUnlessRefused", () => {
  it("only says why for a refused message, without sending it", () => {
    const calls: string[] = [];
    sendUnlessRefused(" /clear now", () => calls.push("sent"), (reason) => calls.push(reason));
    expect(calls).toEqual(["/clear is not available in this plugin."]);
  });

  it("only sends anything else, without a word", () => {
    const calls: string[] = [];
    sendUnlessRefused("don't /clear yet", () => calls.push("sent"), (reason) => calls.push(reason));
    sendUnlessRefused("", () => calls.push("sent"), (reason) => calls.push(reason));
    expect(calls).toEqual(["sent", "sent"]);
  });
});
