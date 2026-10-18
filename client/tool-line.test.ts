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
const between = (start: string) => chat.slice(chat.indexOf(start), chat.indexOf("\nfunction ", chat.indexOf(start) + 1));
const toolLine = chat.slice(chat.indexOf("function ToolLine("), chat.indexOf("\nfunction ", chat.indexOf("function ToolLine(") + 1));

describe("a tool call's line", () => {
  it("draws the label and the detail as separate texts, never one text spaced apart", () => {
    expect(toolLine).not.toBe("");
    expect(toolLine).toMatch(/<Text style=\{\[?styles\.toolLabel\b[^>]*>\s*\{tool\.label\}\s*<\/Text>/);
    expect(toolLine).toMatch(/<Text style=\{\[?styles\.toolText\b[^>]*>\s*\{tool\.summary\}\s*<\/Text>/);
    expect(toolLine).not.toMatch(/` +\$\{tool\.summary\}`/);
  });

  it("keeps a running call's icon and shimmers its words, as Paseo does (TR-183)", () => {
    expect(toolLine).not.toMatch(/<Spinner/);
    expect(toolLine).toMatch(/<Icon name=\{tool\.status === "failed" \? "TriangleAlert" : tool\.icon\}/);
    expect(toolLine).toMatch(/<Shimmer\s+active=\{running\}/);
  });

  it("keeps the icon muted while the call runs, as Paseo does: only a failure colours it (TR-184)", () => {
    expect(toolLine).toMatch(/color=\{tool\.status === "failed" \? theme\.colors\.statusDanger : theme\.colors\.foregroundMuted\}/);
    const group = between("function TranscriptGroupView(");
    expect(group).toMatch(/<Icon name=\{open \? "ChevronDown" : "Wrench"\} size=\{13\} color=\{open \? theme\.colors\.foreground : theme\.colors\.foregroundMuted\} \/>/);
  });

  it("shimmers a run of calls' head while one still runs, with no spinner", () => {
    const group = between("function TranscriptGroupView(");
    expect(group).not.toMatch(/<Spinner/);
    expect(group).toMatch(/<Shimmer\s+active=\{summary\.state === "running"\}/);
  });
});
