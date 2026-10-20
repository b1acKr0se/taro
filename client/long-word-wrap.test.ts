import { describe, expect, it } from "vitest";
import { BREAK_LONG_WORDS } from "./long-word-wrap";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("BREAK_LONG_WORDS", () => {
  it("uses anywhere, the value that lowers the minimum width (break-word does not)", () => {
    expect(BREAK_LONG_WORDS).toEqual({ overflowWrap: "anywhere" });
  });

  it("is applied to the user bubble's text", () => {
    const source = readFileSync(join(import.meta.dirname, "agent-chat.tsx"), "utf8");
    expect(source).toMatch(/userText, BREAK_LONG_WORDS/);
  });
});
