import { describe, expect, it, vi } from "vitest";

import { copyText } from "./clipboard";

describe("copyText", () => {
  it("writes through the browser's clipboard when there is one", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await copyText({ navigator: { clipboard: { writeText } } }, "hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("writes through the app's clipboard module on a phone", async () => {
    const setStringAsync = vi.fn(async () => true);
    expect(await copyText({ expo: { modules: { ExpoClipboard: { setStringAsync } } } }, "hello")).toBe(true);
    expect(setStringAsync).toHaveBeenCalledWith("hello");
  });

  it("says no when there is no clipboard or it refuses", async () => {
    expect(await copyText({}, "hello")).toBe(false);
    expect(await copyText({ navigator: { clipboard: { writeText: async () => Promise.reject(new Error("denied")) } } }, "hello")).toBe(false);
  });
});
