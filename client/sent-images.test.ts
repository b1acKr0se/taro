import { describe, expect, it } from "vitest";

import { matchSentImages } from "./sent-images";

const A = { path: "/data/images/a.png", mimeType: "image/png" };
const B = { path: "/data/images/b.png", mimeType: "image/png" };
const C = { path: "/data/images/c.jpg", mimeType: "image/jpeg" };

function captain(key: string, text: string) {
  return { key, kind: "captain", text };
}

describe("matchSentImages", () => {
  it("matches repeated texts in order: the n-th row takes the n-th message", () => {
    const rows = [captain("1", "look"), { key: "2", kind: "mate", text: "look" }, captain("3", " look ")];
    const matched = matchSentImages(rows, [
      { text: "look", images: [A] },
      { text: "look", images: [B, C] },
    ]);
    expect(Object.fromEntries(matched)).toEqual({ "1": [A], "3": [B, C] });
  });

  it("leaves unmatched rows out", () => {
    const matched = matchSentImages([captain("1", "hello"), captain("2", "look"), captain("3", "look")], [{ text: "look", images: [A] }]);
    expect(Object.fromEntries(matched)).toEqual({ "2": [A] });
  });

  it("matches a message with no words to the row drawn as (attachments)", () => {
    const matched = matchSentImages([captain("1", "(attachments)")], [{ text: "", images: [C] }]);
    expect(Object.fromEntries(matched)).toEqual({ "1": [C] });
  });

  it("matches nothing without sent messages", () => {
    expect(matchSentImages([captain("1", "look")], []).size).toBe(0);
  });
});
