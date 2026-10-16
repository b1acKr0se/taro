/**
 * The actions under a chat message's mark (Resend / Dismiss, Retry / Edit, TR-084)
 * are the shared button Catch up uses, not text links, in one row right-aligned under the bubble.
 * React Native that vitest cannot render, so this reads the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const chat = readFileSync(join(__dirname, "agent-chat.tsx"), "utf8");
const markLine = chat.slice(chat.indexOf("function SendMarkLine"), chat.indexOf("function TranscriptGroupView"));

describe("a mark's actions", () => {
  it("are the shared labelled button, with no text link left", () => {
    expect(markLine).toContain("<IconButton");
    expect(markLine).toContain("showLabel");
    expect(markLine).not.toContain("<Pressable");
    expect(chat).not.toContain("markAction:");
  });

  it("sit in one row that does not wrap, right-aligned", () => {
    const row = chat.slice(chat.indexOf("    markActions:"), chat.indexOf("\n", chat.indexOf("    markActions:")));
    expect(row).toContain('flexDirection: "row"');
    expect(row).toContain('justifyContent: "flex-end"');
    expect(row).not.toContain("flexWrap");
  });
});
