import { describe, expect, it } from "vitest";

import { COMPOSER_FIELD_PADDING, COMPOSER_MAX_LINES, COMPOSER_ONE_LINE, composerFieldHeight } from "./composer-height";

const line = COMPOSER_ONE_LINE - 2 * COMPOSER_FIELD_PADDING;
const max = line * COMPOSER_MAX_LINES + 2 * COMPOSER_FIELD_PADDING;

describe("composerFieldHeight", () => {
  it("is one line while empty, whatever the field last measured", () => {
    expect(composerFieldHeight("", null)).toBe(COMPOSER_ONE_LINE);
    expect(composerFieldHeight("", 200)).toBe(COMPOSER_ONE_LINE);
  });

  it("is one line before the first measurement and for a short draft", () => {
    expect(composerFieldHeight("hi", null)).toBe(COMPOSER_ONE_LINE);
    expect(composerFieldHeight("hi", 0)).toBe(COMPOSER_ONE_LINE);
    expect(composerFieldHeight("hi", COMPOSER_ONE_LINE)).toBe(COMPOSER_ONE_LINE);
  });

  it("grows with the text", () => {
    expect(composerFieldHeight("two\nlines", line * 2 + 2 * COMPOSER_FIELD_PADDING)).toBe(line * 2 + 2 * COMPOSER_FIELD_PADDING);
  });

  it("stops at the maximum and scrolls past it", () => {
    expect(composerFieldHeight("long", max)).toBe(max);
    expect(composerFieldHeight("long", max + 1)).toBe(max);
    expect(composerFieldHeight("long", 10_000)).toBe(max);
  });
});
