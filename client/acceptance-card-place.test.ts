/**
 * The acceptance card sits at the end of the owner's chat (TR-091): under every message, the ones
 * still on their way and questions tied to no message, so nothing said after the delivery buries
 * it; only a permission request, which holds the agent up, comes after it. React Native that
 * vitest cannot render, so this reads the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const chat = readFileSync(join(__dirname, "agent-chat.tsx"), "utf8");
const transcript = chat.slice(chat.indexOf("<KeyboardRevealProvider"), chat.indexOf("</KeyboardRevealProvider>"));
const rowView = chat.slice(chat.indexOf("function TranscriptGroupView"));

describe("the acceptance card's place", () => {
  it("is after the messages, the sent ones and the unplaced questions, before permission requests", () => {
    const card = transcript.indexOf("{delivery.card}");
    expect(card).toBeGreaterThan(-1);
    expect(transcript.indexOf("groups.map(")).toBeLessThan(card);
    expect(transcript.indexOf("echoes.map(")).toBeLessThan(card);
    expect(transcript.indexOf("places.unplaced")).toBeLessThan(card);
    expect(transcript.indexOf("pending.map(")).toBeGreaterThan(card);
  });

  it("is drawn whenever there is a delivery, never inside a message row", () => {
    expect(transcript).toMatch(/\{delivery === undefined \? null : \(\s*<View[^\n]*\n\s*\{delivery\.card\}/);
    expect(transcript.match(/delivery\.card/g)).toHaveLength(1);
    expect(rowView).not.toMatch(/delivery/i);
  });

  it("is measured again when the transcript grows, as a web browser's onLayout reports only a resize", () => {
    expect(chat).toMatch(/onContentSizeChange=\{[\s\S]*?if \(delivery !== undefined\) measureDelivery\(\);/);
    expect(chat).toMatch(/<View ref=\{deliveryView\}[^\n]*\n\s*\{delivery\.card\}/);
    const jump = chat.slice(chat.indexOf("function jumpToFirst"), chat.indexOf("function measureDelivery"));
    expect(jump).toContain("measureDelivery(scroll)");
  });

  it("is shown by following the transcript's end when it fits, on opening and from its Show link", () => {
    const place = chat.slice(chat.indexOf("function placeFirst"), chat.indexOf("function noteLayout"));
    expect(place).toMatch(/firstKey === deliveryTarget && cardFits\(layout\.height, follow\.viewport\.current\)\) follow\.reveal\(/);
    const jump = chat.slice(chat.indexOf("function jumpToFirst"), chat.indexOf("function measureDelivery"));
    expect(jump).toMatch(/firstKey === deliveryTarget && cardFits\(layout\.height, follow\.viewport\.current\)\) follow\.jumpToEnd\(\)/);
  });
});
