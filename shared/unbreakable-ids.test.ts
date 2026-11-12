import { describe, expect, it } from "vitest";

import { unbreakableIds } from "./unbreakable-ids";

const NB = "‑";

describe("unbreakableIds", () => {
  it("makes a ticket id's hyphen non-breaking, a child's id included", () => {
    expect(unbreakableIds("NA-002.02 — Export button — M — depends on: NA-002.01")).toBe(`NA${NB}002.02 — Export button — M — depends on: NA${NB}002.01`);
    expect(unbreakableIds("(TR-12) and `SH-3`, then TR2-7.")).toBe(`(TR${NB}12) and \`SH${NB}3\`, then TR2${NB}7.`);
  });

  it("leaves words that are not ticket ids", () => {
    for (const text of ["a one-off", "UTF-8x", "e-mail 2026-11-12", "x-1", "Size: M-L", "taro/tr-263", "TR-12-beta"]) expect(unbreakableIds(text)).toBe(text);
  });

  it("leaves link targets, autolinks and addresses as written", () => {
    expect(unbreakableIds("[TR-12](https://example.com/TR-12)")).toBe(`[TR${NB}12](https://example.com/TR-12)`);
    expect(unbreakableIds("see <https://example.com/browse/TR-12> or https://example.com/TR-13 now")).toBe("see <https://example.com/browse/TR-12> or https://example.com/TR-13 now");
    expect(unbreakableIds("branch taro/TR-12 and file docs/TR-12.md")).toBe("branch taro/TR-12 and file docs/TR-12.md");
  });
});
