/**
 * A chat opens on its first open decision (TR-133). During the first read a decision has no message
 * yet; drawn at the empty transcript's end it took the opening scroll, which a browser clamps to the
 * short content, and the clamped scroll read as the reader's own, so the scrolls to the card under
 * its message that followed were refused. Like the acceptance card (TR-131), a decision is drawn at
 * the end only once the first read is done. React Native that vitest cannot render, so this reads
 * the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const chat = readFileSync(join(__dirname, "agent-chat.tsx"), "utf8");
const transcript = chat.slice(chat.indexOf("<KeyboardRevealProvider"), chat.indexOf("</KeyboardRevealProvider>"));

describe("a decision with no message in the transcript", () => {
  it("is drawn at the end only once the first read is done and nothing older is left to read (TR-239)", () => {
    const atEnd = transcript.slice(transcript.indexOf("echoes.map("), transcript.indexOf("decisionCards(places.unplaced)"));
    expect(atEnd).toMatch(/\{unplacedNow !== "end" \|\| places === null \? null : \(/);
  });

  it("is the only place unplaced decisions are drawn", () => {
    expect(chat.match(/places\.unplaced/g)).toHaveLength(3);
  });
});
