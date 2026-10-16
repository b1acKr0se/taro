/**
 * Sending changes ends a delivery at once (TR-131): the card and its Accept row leave the chat on the
 * Send's success, before the board reads the ticket back In Progress. React Native that vitest cannot
 * render, so this reads the source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pane = readFileSync(join(__dirname, "owner-pane.tsx"), "utf8");
const card = readFileSync(join(__dirname, "acceptance-card.tsx"), "utf8");
const follow = readFileSync(join(__dirname, "follow-end.ts"), "utf8");

describe("ending a delivery when changes are sent", () => {
  it("stops accepting for the card as it was when the changes went, and only for that one", () => {
    expect(pane).toMatch(/const deliveryEnded = changesSentOn === `\$\{card\.id\}@\$\{card\.updatedAt \?\? ""\}`;/);
    // The card's own test otherwise (`offersAcceptance`): no owner question open (TR-146), no owner turn running (TR-153).
    expect(pane).toMatch(/const accepting = offersAcceptance\(card\) && !deliveryEnded;/);
    expect(pane).toMatch(/onChangesSent=\{\(\) => setChangesSentOn\(`\$\{card\.id\}@\$\{card\.updatedAt \?\? ""\}`\)\}/);
  });

  it("is told by the card only once the changes were sent, not when the box opens or is cancelled", () => {
    const sent = card.slice(card.indexOf('actions.press("request-changes"'), card.indexOf("onCancel="));
    expect(sent).toMatch(/onSuccess: \(\) => \{[\s\S]*onChangesSent\?\.\(\);[\s\S]*\}/);
    expect(card.match(/onChangesSent\?\.\(\)/g)).toHaveLength(1);
    expect(card).toMatch(/onCancel=\{\(\) => setWriting\(false\)\}/);
    expect(card).toMatch(/onRequestChanges=\{\(\) => setWriting\(true\)\}/);
  });

  it("accepts from the row as the card's own Accept does", () => {
    const row = card.slice(card.indexOf("export function AcceptNow"));
    expect(row).toMatch(/actions\.press\("accept", \(\) => accept\(\{ project, ticket: card\.id \}\)/);
  });
});

describe("a scroll reported while a reveal is pending (TR-131)", () => {
  it("still records where the view is, and only leaves following alone", () => {
    const handler = follow.slice(follow.indexOf("function scrolled(event"), follow.indexOf("/** Spread onto the transcript"));
    expect(handler).not.toMatch(/kind === "stale"\) return/);
    const decides = handler.slice(handler.indexOf('if (kind !== "stale") {'), handler.indexOf("offset.current = contentOffset.y;"));
    expect(decides).toContain("pinnedToEnd.current = isAtEnd(");
    expect(decides).toContain("readerScrolled.current = true");
    expect(handler.indexOf("onScrolled?.(contentOffset.y")).toBeGreaterThan(handler.indexOf("offset.current = contentOffset.y;"));
  });
});
