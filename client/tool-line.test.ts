/**
 * A tool call's line puts its label and its command or path apart, as Paseo does (TR-150). The web
 * build collapses runs of spaces inside one text, so a gap made of spaces read "Shell export…" on
 * desktop; the label and the detail are separate texts with the row's gap between them. The line is
 * React Native that vitest cannot render, so this reads its source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const chat = readFileSync(join(__dirname, "agent-chat.tsx"), "utf8");
const toolLine = chat.slice(chat.indexOf("function ToolLine("), chat.indexOf("\nfunction ", chat.indexOf("function ToolLine(") + 1));

describe("a tool call's line", () => {
  it("draws the label and the detail as separate texts, never one text spaced apart", () => {
    expect(toolLine).not.toBe("");
    expect(toolLine).toMatch(/<Text style=\{styles\.toolLabel\}[^>]*>\s*\{tool\.label\}\s*<\/Text>/);
    expect(toolLine).toMatch(/<Text style=\{styles\.toolText\}[^>]*>\s*\{tool\.summary\}\s*<\/Text>/);
    expect(toolLine).not.toMatch(/` +\$\{tool\.summary\}`/);
  });
});
