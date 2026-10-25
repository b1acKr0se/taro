import { describe, expect, it } from "vitest";

import { judgeMockups, parseMockups } from "./mockups";
import { parsePlan } from "./plan";

const plan = (mockups: string | null) => parsePlan(`## Goal\nG\n${mockups === null ? "" : `## Mockups\n${mockups}\n`}## Size\nS`);
const folder = "/data/evidence/TR-1";

describe("parseMockups", () => {
  it("has no section for a plan without one, or no plan", () => {
    expect(parseMockups(plan(null)).section).toBeNull();
    expect(parseMockups(null).section).toBeNull();
  });

  it("reads file — description lines, with backticks and other separators", () => {
    const parsed = parseMockups(plan("- mockup-board-phone.png — the board gains a badge\n- `mockup-board-desktop.png` - same on desktop\n- mockup-x.png"));
    expect(parsed.section).toEqual({
      images: [
        { file: "mockup-board-phone.png", description: "the board gains a badge" },
        { file: "mockup-board-desktop.png", description: "same on desktop" },
        { file: "mockup-x.png", description: "" },
      ],
      none: null,
    });
  });

  it("reads none with its reason, in any case, as bullet or prose", () => {
    expect(parseMockups(plan("- none — skill text only")).section).toEqual({ images: [], none: "skill text only" });
    expect(parseMockups(plan("None — server only")).section).toEqual({ images: [], none: "server only" });
    expect(parseMockups(plan("- NONE")).section).toEqual({ images: [], none: "" });
  });
});

describe("judgeMockups", () => {
  const files = new Set(["a-phone.png", "a-desktop.png"]);

  it("asks for a section when the plan has none", () => {
    expect(judgeMockups(plan(null), files, folder).missing).toHaveLength(1);
    expect(judgeMockups(null, files, folder).missing).toHaveLength(1);
  });

  it("accepts images that exist with a description, and none with a reason", () => {
    const judged = judgeMockups(plan("- a-phone.png — one\n- a-desktop.png — two"), files, folder);
    expect(judged.missing).toEqual([]);
    expect(judged.images.map((image) => image.path)).toEqual([`${folder}/a-phone.png`, `${folder}/a-desktop.png`]);
    expect(judgeMockups(plan("- none — wording only"), files, folder)).toMatchObject({ missing: [], none: "wording only" });
  });

  it("refuses an empty section, a none without a reason, a missing file, no description and a path", () => {
    expect(judgeMockups(plan(""), files, folder).missing).toHaveLength(1);
    expect(judgeMockups(plan("- none"), files, folder).missing).toEqual(["a reason after `none —` under Mockups"]);
    expect(judgeMockups(plan("- gone.png — x"), files, folder).missing).toEqual(["mockup file gone.png in the evidence folder"]);
    expect(judgeMockups(plan("- a-phone.png"), files, folder).missing).toEqual(["a description for mockup a-phone.png"]);
    const escaping = judgeMockups(plan("- ../a-phone.png — x"), files, folder);
    expect(escaping.missing).toEqual(["a plain file name for mockup ../a-phone.png (no folders)"]);
    expect(escaping.images[0]?.path).toBe("");
  });
});
