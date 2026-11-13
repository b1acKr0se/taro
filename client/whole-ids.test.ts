import { describe, expect, it } from "vitest";

import { inlineTokens } from "./file-links";
import { drawnPieces } from "./whole-ids";

const noFiles = () => null;
const drawn = (text: string, web: boolean) => inlineTokens(text, noFiles).map((token) => ({ kind: token.kind, text: token.text, pieces: drawnPieces(token, web) }));

describe("drawnPieces", () => {
  it("leaves a backticked id as written", () => {
    for (const web of [true, false]) expect(drawn("run `taro ticket view TR-12`", web)[1]).toEqual({ kind: "code", text: "taro ticket view TR-12", pieces: null });
  });

  it("leaves an id in a link's text unchanged", () => {
    for (const web of [true, false]) expect(drawn("[TR-12](https://example.com/TR-12)", web)[0]).toEqual({ kind: "link", text: "TR-12", pieces: null });
  });

  it("draws an id in prose with U+2011 on native", () => {
    expect(drawn("depends on: NA-002.01", false)[0]?.pieces).toEqual([
      { text: "depends on: ", nowrap: false },
      { text: "NA‑002.01", nowrap: false },
    ]);
    expect(drawn("**SH-3** first", false)[0]?.pieces).toEqual([{ text: "SH‑3", nowrap: false }]);
  });

  it("draws an id in prose on the web as a nowrap run keeping the plain hyphen", () => {
    expect(drawn("depends on: NA-002.01", true)[0]?.pieces).toEqual([
      { text: "depends on: ", nowrap: false },
      { text: "NA-002.01", nowrap: true },
    ]);
  });
});
