import { describe, expect, it } from "vitest";

import { decisionBlocksAsText, parseDecisionBlocks, parseStatusLine, withImagePaths, withoutDecisionBlocks } from "./reports";

describe("parseStatusLine", () => {
  it("reads the last line", () => {
    expect(parseStatusLine("Did it.\n\ndone: PR https://x/1 ready")).toEqual({ state: "done", text: "PR https://x/1 ready" });
    expect(parseStatusLine("waiting: implementer SC-1.2 on the API")).toEqual({ state: "waiting", text: "implementer SC-1.2 on the API" });
  });

  it("tolerates markdown emphasis and case", () => {
    expect(parseStatusLine("**Blocked**: needs a token")).toEqual({ state: "blocked", text: "needs a token" });
    expect(parseStatusLine("`done: shipped`")).toEqual({ state: "done", text: "shipped" });
  });

  it("ignores a state word far above the end", () => {
    expect(parseStatusLine("done: early\none\ntwo\nthree\nfour")).toBeNull();
  });

  it("returns null without a status line", () => {
    expect(parseStatusLine("All finished, nothing else.")).toBeNull();
  });
});

const BLOCK = [
  "Here is my question.",
  "",
  "```decision",
  "id: fee-storage            # unique within the ticket",
  "question: Store fees per trade or aggregate hourly?",
  'why: "Hourly loses audit; per-trade is ~40× bigger"',
  "blocking: false",
  "options:",
  "  - label: Per trade",
  "    prompt: Store fees per trade",
  "    consequence: full audit",
  "  - label: Hourly",
  "    prompt: Aggregate fees hourly",
  "recommended: Per trade",
  "reason: audits need it",
  "default: Per trade",
  "```",
  "",
  "waiting: your choice on fee storage",
].join("\n");

describe("parseDecisionBlocks", () => {
  it("reads a complete block", () => {
    const [decision] = parseDecisionBlocks(BLOCK);
    expect(decision).toMatchObject({
      id: "fee-storage",
      question: "Store fees per trade or aggregate hourly?",
      why: "Hourly loses audit; per-trade is ~40× bigger",
      blocking: false,
      recommended: "Per trade",
      reason: "audits need it",
      default: "Per trade",
      withdrawn: false,
      problems: [],
    });
    expect(decision?.options).toEqual([
      { label: "Per trade", prompt: "Store fees per trade", consequence: "full audit", images: [] },
      { label: "Hourly", prompt: "Aggregate fees hourly", consequence: "", images: [] },
    ]);
  });

  it("reports what is missing instead of failing", () => {
    const [decision] = parseDecisionBlocks("```decision\nquestion: Which?\noptions:\n  - label: A\n```");
    expect(decision?.problems).toEqual(["no recommended option", "no reason for the recommendation", "no id"]);
    expect(decision?.options).toEqual([{ label: "A", prompt: "A", consequence: "", images: [] }]);
    expect(decision?.id).toMatch(/^untitled-/);
  });

  it("reads several blocks, blocking flags and withdrawal", () => {
    const text = "```decision\nid: a\nquestion: Q1\nblocking: true\noptions:\n  - label: X\nrecommended: X\nreason: r\n```\n```decision\nid: b\nstatus: withdrawn\n```";
    const decisions = parseDecisionBlocks(text);
    expect(decisions.map((decision) => [decision.id, decision.blocking, decision.withdrawn])).toEqual([
      ["a", true, false],
      ["b", false, true],
    ]);
  });

  it("strips blocks from the text the chat shows", () => {
    expect(withoutDecisionBlocks(BLOCK)).toBe("Here is my question.\n\nwaiting: your choice on fee storage");
  });

  it("turns blocks into a quote of the question and options for a finished agent's chat", () => {
    const text = "Before I start:\n```decision\nid: a\nquestion: |\n  Store fees\n  per trade?\noptions:\n  - label: Per trade\n  - label: Hourly\nrecommended: Per trade\nreason: r\n```\nwaiting: your answer";
    expect(decisionBlocksAsText(text)).toBe("Before I start:\n> **Asked:** Store fees per trade?\n>\n> **Per trade** (recommended) · Hourly\n\nwaiting: your answer");
  });

  it("drops withdrawn blocks and quotes a block without options as its question alone", () => {
    expect(decisionBlocksAsText("```decision\nid: b\nstatus: withdrawn\n```\nok")).toBe("ok");
    expect(decisionBlocksAsText("```decision\nid: c\nquestion: Which?\n```")).toBe("> **Asked:** Which?");
    expect(decisionBlocksAsText("no blocks here")).toBe("no blocks here");
  });

  it("flags a recommendation that names no option", () => {
    const [decision] = parseDecisionBlocks("```decision\nid: x\nquestion: Q\noptions:\n  - label: A\nrecommended: B\nreason: r\n```");
    expect(decision?.problems).toEqual(["recommended names no option"]);
  });
});

/** TR-007's scope-approval block, verbatim from its owner's transcript (agent 0a0ed21c): the card showed only "|". */
const TR_007_BLOCK = [
  "```decision",
  "id: scope-approval",
  "question: Approve the plan to save turn start times to disk for TR-007?",
  "why: |",
  "  Turn start times would be saved in state/stats.json next to the ticket data, under the same lock. A turn that spans a reload then gets its full duration. Older stats files that lack the new field still load.",
  "  When the plugin starts, it drops the saved start of any agent that is no longer mid-turn, because that turn ended while the plugin was down; pairing it with a later end would overcount.",
  "  A vitest test covers three cases: a reload mid-turn, a missing start, and a dropped stale start. I'll also check it on a throwaway daemon and record the result in the build log. Complexity is medium because this touches stored data, so it gets one independent review.",
  "  Not included: correcting TR-001's existing figures, or turns that start and end while the plugin is down (those still go uncounted).",
  "blocking: true",
  "options:",
  "  - label: Approve",
  "    prompt: Approve",
  "    consequence: I build it as proposed",
  "  - label: Change…",
  "    prompt: Change…",
  "  - label: Split into children",
  "    prompt: Split into children",
  "recommended: Approve",
  "reason: Paseo's turn-end hook gives no timestamps, so saving the start times is the only reliable source that doesn't need an extra fetch on every turn",
  "```",
  "",
  "waiting: scope approval for TR-007",
].join("\n");

function decisionOf(...lines: string[]) {
  const [decision] = parseDecisionBlocks(["```decision", ...lines, "```"].join("\n"));
  if (decision === undefined) throw new Error("no decision parsed");
  return decision;
}

describe("parseDecisionBlocks multi-line values", () => {
  it("keeps every line of TR-007's literal why", () => {
    const [decision] = parseDecisionBlocks(TR_007_BLOCK);
    expect(decision?.why).toBe(
      [
        "Turn start times would be saved in state/stats.json next to the ticket data, under the same lock. A turn that spans a reload then gets its full duration. Older stats files that lack the new field still load.",
        "When the plugin starts, it drops the saved start of any agent that is no longer mid-turn, because that turn ended while the plugin was down; pairing it with a later end would overcount.",
        "A vitest test covers three cases: a reload mid-turn, a missing start, and a dropped stale start. I'll also check it on a throwaway daemon and record the result in the build log. Complexity is medium because this touches stored data, so it gets one independent review.",
        "Not included: correcting TR-001's existing figures, or turns that start and end while the plugin is down (those still go uncounted).",
      ].join("\n"),
    );
    expect(decision).toMatchObject({ id: "scope-approval", blocking: true, recommended: "Approve", problems: [] });
    expect(decision?.options).toEqual([
      { label: "Approve", prompt: "Approve", consequence: "I build it as proposed", images: [] },
      { label: "Change…", prompt: "Change…", consequence: "", images: [] },
      { label: "Split into children", prompt: "Split into children", consequence: "", images: [] },
    ]);
  });

  it("reads | and > for every top-level field", () => {
    const decision = decisionOf(
      "id: >-",
      "  fee-storage",
      "question: >",
      "  Store fees per trade",
      "  or aggregate hourly?",
      "why: |",
      "  Hourly loses audit.",
      "",
      "  Per trade is bigger.",
      "blocking: |-",
      "  true",
      "options:",
      "  - label: Per trade",
      "recommended: >",
      "  Per trade",
      "reason: |+",
      "  audits need it",
      "",
      "default: >",
      "  Per",
      "  trade",
    );
    expect(decision).toMatchObject({
      id: "fee-storage",
      question: "Store fees per trade or aggregate hourly?",
      why: "Hourly loses audit.\n\nPer trade is bigger.",
      blocking: true,
      recommended: "Per trade",
      reason: "audits need it",
      default: "Per trade",
      problems: [],
    });
  });

  it("reads | and > for every option field, including the one on the - line", () => {
    const decision = decisionOf(
      "id: x",
      "question: Q",
      "options:",
      "  - label: >",
      "      Per",
      "      trade",
      "    prompt: |",
      "      Store fees per trade.",
      "      Keep the audit.",
      "    consequence: >-",
      "      full",
      "      audit",
      "  - label: Hourly",
      "    prompt: |",
      "    consequence: small",
      "recommended: Per trade",
      "reason: r",
    );
    expect(decision.options).toEqual([
      { label: "Per trade", prompt: "Store fees per trade.\nKeep the audit.", consequence: "full audit", images: [] },
      { label: "Hourly", prompt: "Hourly", consequence: "small", images: [] },
    ]);
    expect(decision.problems).toEqual([]);
  });

  it("reads a scalar list item written over several lines", () => {
    const decision = decisionOf("id: x", "question: Q", "options:", "  - |", "    A", "    B", "recommended: A", "reason: r");
    expect(decision.options).toEqual([{ label: "A\nB", prompt: "A\nB", consequence: "", images: [] }]);
  });

  it("folds > the YAML way: blank lines and more-indented lines keep their breaks", () => {
    const decision = decisionOf("why: >", "  one", "  two", "", "  three", "    indented", "  four");
    expect(decision.why).toBe("one two\nthree\n  indented\nfour");
  });

  it("honours an indentation indicator and keeps content that looks like a key or a comment", () => {
    const decision = decisionOf("why: |2  # a header comment", "    indented line", "  options: none", "  # not a comment here", "question: Q");
    expect(decision.why).toBe("  indented line\noptions: none\n# not a comment here");
    expect(decision.question).toBe("Q");
    expect(decision.options).toEqual([]);
  });

  it("folds plain and quoted values continued on indented lines", () => {
    const decision = decisionOf(
      "question: Store fees per trade",
      "  or aggregate hourly?",
      'why: "Hourly loses audit;',
      '  per-trade is \\"bigger\\""',
      "reason:",
      "  audits need it",
      "options:",
      "  - label: Per",
      "      trade",
      "    consequence: 'it''s",
      "      full'",
    );
    expect(decision.question).toBe("Store fees per trade or aggregate hourly?");
    expect(decision.why).toBe('Hourly loses audit; per-trade is "bigger"');
    expect(decision.reason).toBe("audits need it");
    expect(decision.options).toEqual([{ label: "Per trade", prompt: "Per trade", consequence: "it's full", images: [] }]);
  });
});

describe("parseDecisionBlocks option images (TR-055)", () => {
  const block = (...optionLines: string[]) =>
    parseDecisionBlocks(["```decision", "id: nav", "question: Which navigation?", "options:", ...optionLines, "recommended: Pills", "reason: r", "```"].join("\n"))[0]!;
  const image = (file: string, caption: string) => ({ file, caption, path: null });

  it("reads one image per line of a | block, each with its caption", () => {
    const decision = block("  - label: Pills", "    images: |", "      option-a-pills-phone.png — the list on a phone", "      option-a-pills-desktop.png — the list on a desktop");
    expect(decision.options[0]?.images).toEqual([image("option-a-pills-phone.png", "the list on a phone"), image("option-a-pills-desktop.png", "the list on a desktop")]);
    expect(decision.problems).toEqual([]);
  });

  it("reads a YAML list under the key without taking its items for options", () => {
    const decision = block("  - label: Pills", "    images:", "      - option-a-phone.png — on a phone", "      - `option-a-desktop.png` -- on a desktop", "  - label: Tabs");
    expect(decision.options.map((option) => option.label)).toEqual(["Pills", "Tabs"]);
    expect(decision.options[0]?.images).toEqual([image("option-a-phone.png", "on a phone"), image("option-a-desktop.png", "on a desktop")]);
    expect(decision.options[1]?.images).toEqual([]);
  });

  it("reads a single image on the key's own line, and on the - line", () => {
    const decision = block("  - label: Pills", "    images: option-a.png — the list", "  - images: option-b.png — tabs", "    label: Tabs");
    expect(decision.options[0]?.images).toEqual([image("option-a.png", "the list")]);
    expect(decision.options[1]).toMatchObject({ label: "Tabs", images: [image("option-b.png", "tabs")] });
  });

  it("asks for a caption and a plain file name", () => {
    const decision = block("  - label: Pills", "    images: |", "      option-a.png", "      ../elsewhere/b.png — escapes");
    expect(decision.problems).toEqual(["image option-a.png of option Pills has no caption", "image ../elsewhere/b.png of option Pills is not a plain file name (no folders)"]);
  });

  it("gives each image its path in the ticket's folder, and none without one or for a name with a folder", () => {
    const options = [{ label: "Pills", prompt: "Pills", consequence: "", images: [image("a.png", "x"), image("dir/b.png", "y")] }];
    expect(withImagePaths(options, "/evidence/notes/NA-1")[0]?.images.map((each) => each.path)).toEqual(["/evidence/notes/NA-1/a.png", null]);
    expect(withImagePaths(options, null)[0]?.images.map((each) => each.path)).toEqual([null, null]);
  });
});
