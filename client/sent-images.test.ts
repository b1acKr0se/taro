import { describe, expect, it } from "vitest";

import { matchSentImages } from "./sent-images";

const A = { path: "/data/uploads/a.png", mimeType: "image/png" };
const B = { path: "/data/uploads/b.png", mimeType: "image/png" };
const C = { path: "/data/uploads/c.jpg", mimeType: "image/jpeg" };

function user(key: string, text: string) {
  return { key, kind: "user", text };
}

describe("matchSentImages", () => {
  it("matches repeated texts in order: the n-th row takes the n-th message", () => {
    const rows = [user("1", "look"), { key: "2", kind: "agent", text: "look" }, user("3", " look ")];
    const matched = matchSentImages(rows, [
      { text: "look", images: [A] },
      { text: "look", images: [B, C] },
    ]);
    expect(Object.fromEntries(matched)).toEqual({ "1": [A], "3": [B, C] });
  });

  it("leaves unmatched rows out, counting repeats from the newest", () => {
    const matched = matchSentImages([user("1", "hello"), user("2", "look"), user("3", "look")], [{ text: "look", images: [A] }]);
    expect(Object.fromEntries(matched)).toEqual({ "3": [A] });
  });

  it("still matches when older rows have fallen out of the chat's tail", () => {
    const matched = matchSentImages([user("9", "continue")], [
      { text: "continue", images: [A] },
      { text: "continue", images: [B] },
    ]);
    expect(Object.fromEntries(matched)).toEqual({ "9": [B] });
  });

  it("matches a message with no words to the row drawn as (attachments)", () => {
    const matched = matchSentImages([user("1", "(attachments)")], [{ text: "", images: [C] }]);
    expect(Object.fromEntries(matched)).toEqual({ "1": [C] });
  });

  it("gives a repeated text its images only on the message that carried them", () => {
    const matched = matchSentImages([user("1", "look"), user("2", "look")], [
      { text: "look", images: [A] },
      { text: "look", images: [] },
    ]);
    expect(Object.fromEntries(matched)).toEqual({ "1": [A] });
  });

  it("matches nothing without sent messages", () => {
    expect(matchSentImages([user("1", "look")], []).size).toBe(0);
  });
});
