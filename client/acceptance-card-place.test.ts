/**
 * The acceptance card sits under the message that delivered (TR-131), like any other part of the
 * chat: what is said after it goes below it and scrolls it away, and the row at the composer offers
 * Accept while it is off screen. With that message older than the timeline it sits at the end, as
 * TR-091 had it; a permission request, which holds the agent up, always comes after it. React Native
 * that vitest cannot render, so this reads the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const chat = readFileSync(join(__dirname, "agent-chat.tsx"), "utf8");
const transcript = chat.slice(chat.indexOf("<KeyboardRevealProvider"), chat.indexOf("</KeyboardRevealProvider>"));
const rowView = chat.slice(chat.indexOf("function TranscriptGroupView"));
const composer = chat.slice(chat.indexOf("<View style={styles.composer}>"));

describe("the acceptance card's place", () => {
  it("follows the delivering message's group, beside it rather than inside it", () => {
    const groupsAt = transcript.indexOf("groups.map(");
    const underRow = transcript.indexOf("{row?.key === deliveryRow ? deliveryCard : null}");
    expect(underRow).toBeGreaterThan(groupsAt);
    expect(transcript.indexOf("<TranscriptGroup", groupsAt)).toBeLessThan(underRow);
    expect(transcript.indexOf("echoes.map(")).toBeGreaterThan(underRow);
    expect(rowView).not.toMatch(/delivery/i);
    expect(chat).toMatch(/deliveryRowKey\(agentRows\)/);
  });

  it("is at the end only when no loaded message delivered, after the unplaced questions and before permission requests", () => {
    const atEnd = transcript.indexOf("{deliveryRow === null ? deliveryCard : null}");
    expect(atEnd).toBeGreaterThan(transcript.indexOf("places.unplaced"));
    expect(atEnd).toBeGreaterThan(transcript.indexOf("echoes.map("));
    expect(transcript.indexOf("pending.map(")).toBeGreaterThan(atEnd);
    expect(chat.match(/delivery\.card/g)).toHaveLength(1);
  });

  it("is measured again when the transcript grows, as a web browser's onLayout reports only a resize", () => {
    expect(chat).toMatch(/onContentSizeChange=\{[\s\S]*?if \(delivery !== undefined\) measureDelivery\(\);/);
    expect(chat).toMatch(/<View ref=\{deliveryView\}[^\n]*\n\s*\{delivery\.card\}/);
    const jump = chat.slice(chat.indexOf("function jumpToFirst"), chat.indexOf("function measureDelivery"));
    expect(jump).toContain("measureDelivery(scroll)");
  });

  it("is shown by following the end only when nothing was said after it; otherwise scrolled to like a question", () => {
    const place = chat.slice(chat.indexOf("function placeFirst"), chat.indexOf("function noteLayout"));
    expect(place).toMatch(/firstKey === deliveryTarget && deliveryLast && cardFits\(layout\.height, follow\.viewport\.current\)\) follow\.reveal\(/);
    expect(place).toMatch(/else follow\.revealRow\(firstKey, layout, offsetShowingCard\)/);
    const jump = chat.slice(chat.indexOf("function jumpToFirst"), chat.indexOf("function measureDelivery"));
    expect(jump).toMatch(/firstKey === deliveryTarget && deliveryLast && cardFits\(layout\.height, follow\.viewport\.current\)\) follow\.jumpToEnd\(\)/);
    expect(chat).toMatch(/const deliveryLast = deliveryRow === null \|\| groups\[groups\.length - 1\]\?\.key === deliveryRow;/);
  });

  it("is offered in the composer's row while off screen: Accept when ready, and Show", () => {
    const row = composer.slice(0, composer.indexOf("places?.first === null"));
    expect(row).toMatch(/firstOnScreen \|\| places !== null \|\| delivery === undefined \? null/);
    expect(row).toContain("{delivery.ready ? delivery.accept : null}");
    expect(row.indexOf("delivery.accept")).toBeLessThan(row.indexOf(">Show<"));
  });
});
