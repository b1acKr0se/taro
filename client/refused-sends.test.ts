/**
 * Every Taro box that sends the user's words as a prompt refuses `/clear` itself, before its call
 * starts (TR-232): the server refuses it too, but only after a card's button has spun, and a Request
 * changes box's words reach the server inside a sentence, where the server cannot see them first.
 * The boxes are React components, so this reads their source for the shared step on each send path.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CLIENT = dirname(fileURLToPath(import.meta.url));

function source(file: string): string {
  return readFileSync(join(CLIENT, file), "utf8");
}

describe("the boxes refuse /clear before sending (TR-232)", () => {
  it("the chats' and cards' reply box: its Send button and Enter both go through the refusal", () => {
    const text = source("reply-box.tsx");
    expect(text).toMatch(/function send\(\): void \{\s*sendUnlessRefused\(value,/);
    expect(text).toContain('if (action === "send") send();');
    expect(text).toMatch(/style=\{\[styles\.send,[^\n]*\]\}\s*onPress=\{send\}/);
    expect(text).not.toMatch(/onSend\?\.\(\);/);
  });

  it("the Request changes box: its Send button goes through the refusal", () => {
    expect(source("change-box.tsx")).toMatch(/onPress=\{\(\) => \{[^}]*sendUnlessRefused\(value, onSend,/);
  });

  it("the decision card: Submit goes through the refusal before its press starts", () => {
    expect(source("decision-card.tsx")).toMatch(/onPress=\{\(\) =>\s*sendUnlessRefused\(\s*submit\.text,\s*\(\) =>\s*presses\.press\(submitPress/);
  });
});
