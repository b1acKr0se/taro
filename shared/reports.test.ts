import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { decisionMessageSegments, parseDecisionBlocks, parseDecisionBody, parseStatusLine, sameQuestion, withImagePaths, withoutDecisionBlocks } from "./reports";

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

  it("reads a list at the key's own indent as images, ending at the next key or option (review finding)", () => {
    const decision = block("  - label: Pills", "    images:", "    - a.png — x", "    - b.png — y", "    prompt: Use pills", "  - label: Tabs", "  - images:", "    - c.png — z", "    label: Rail");
    expect(decision.options.map((option) => [option.label, option.prompt, option.images.map((each) => each.file)])).toEqual([
      ["Pills", "Use pills", ["a.png", "b.png"]],
      ["Tabs", "Tabs", []],
      ["Rail", "Rail", ["c.png"]],
    ]);
    expect(decision.problems).toEqual([]);
  });

  it("drops quotes and comments the YAML way", () => {
    const decision = block("  - label: Pills", "    images:", '      - "b.png" — on a phone', "      - 'a.png — on a desktop # not a comment'  # a comment", "      - c.png — wide  # a comment", "      # a commented-out image", "      - d.png — 'quoted caption'");
    expect(decision.options[0]?.images).toEqual([image("b.png", "on a phone"), image("a.png", "on a desktop # not a comment"), image("c.png", "wide"), image("d.png", "quoted caption")]);
  });

  it("keeps one image per line in a > block too", () => {
    const decision = block("  - label: Pills", "    images: >", "      a.png — on a phone", "      b.png — on a desktop");
    expect(decision.options[0]?.images).toEqual([image("a.png", "on a phone"), image("b.png", "on a desktop")]);
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

describe("a decision fence written the wrong way (TR-197)", () => {
  const JSON_BODY = JSON.stringify(
    {
      id: "scope-approval",
      question: "Approve the plan for TR-195?",
      blocking: true,
      options: [{ label: "Approve", prompt: "Approve the plan for TR-195", consequence: "I build it" }, "Split into children"],
      recommended: "Approve",
      reason: "small and clear",
    },
    null,
    2,
  );

  it("reads a taro-decision fence with a JSON body as a complete decision", () => {
    const message = `Plan is in the ticket.\n\n\`\`\`taro-decision\n${JSON_BODY}\n\`\`\`\n\nwaiting: approval`;
    const [decision] = parseDecisionBlocks(message);
    expect(decision).toMatchObject({ id: "scope-approval", blocking: true, recommended: "Approve", problems: [] });
    expect(decision?.options.map((option) => [option.label, option.prompt])).toEqual([
      ["Approve", "Approve the plan for TR-195"],
      ["Split into children", "Split into children"],
    ]);
    expect(withoutDecisionBlocks(message)).toBe("Plan is in the ticket.\n\nwaiting: approval");
    expect(decisionMessageSegments(message)?.map((segment) => segment.kind)).toEqual(["text", "decision", "text"]);
  });

  it("reads a decision fence with a JSON body", () => {
    expect(parseDecisionBlocks(`\`\`\`decision\n${JSON_BODY}\n\`\`\``)).toHaveLength(1);
  });

  it("reads a taro-decision fence with a YAML body", () => {
    expect(parseDecisionBlocks(BLOCK.replace("```decision", "```taro-decision"))[0]?.id).toBe("fee-storage");
  });

  it("keeps the problems of an incomplete JSON block and falls back to YAML for broken JSON", () => {
    expect(parseDecisionBlocks('```taro-decision\n{"id": "x", "question": "Q"}\n```')[0]?.problems).toContain("no options");
    expect(parseDecisionBlocks("```decision\n{ not json\nid: x\nquestion: Q\n```")[0]?.id).toBe("x");
  });

  it("leaves other fences alone", () => {
    expect(parseDecisionBlocks("```decisions\nid: x\n```")).toEqual([]);
    expect(parseDecisionBlocks("```json\n{}\n```")).toEqual([]);
  });
});

describe("a decision that asks several questions (TR-207)", () => {
  const question = (header: string, labels: string[], recommended = labels[0] ?? "") =>
    [
      `  - header: ${header}`,
      `    question: ${header} as?`,
      "    options:",
      ...labels.flatMap((label) => [`      - label: ${label}`, `        prompt: Use ${label}`]),
      `    recommended: ${recommended}`,
      "    reason: it fits",
    ].join("\n");
  const block = (...questions: string[]) => `id: export\nblocking: true\nquestions:\n${questions.join("\n")}\n`;

  it("reads the ticket's example", () => {
    const body =
      "id: export\nblocking: true\nquestions:\n  - header: Tags\n    question: Tags as?\n    options:\n      - label: YAML\n        prompt: Use YAML\n  - header: Folders\n    question: Layout?\n    options:\n      - label: Flat\n        prompt: One folder\n";
    expect(parseDecisionBody(body)).toMatchObject({
      id: "export",
      blocking: true,
      questions: [
        { header: "Tags", question: "Tags as?", options: [{ label: "YAML", prompt: "Use YAML" }] },
        { header: "Folders", question: "Layout?", options: [{ label: "Flat", prompt: "One folder" }] },
      ],
    });
  });

  it("parses a block with three questions", () => {
    const decision = parseDecisionBody(block(question("Tags", ["YAML", "Hashtags"]), question("Folders", ["Flat", "Nested"], "Nested"), question("Images", ["Copy", "Link", "Leave out"], "Link")));
    expect(decision.problems).toEqual([]);
    expect(decision.questions.map((each) => each.header)).toEqual(["Tags", "Folders", "Images"]);
    expect(decision.questions.map((each) => each.options.map((option) => option.label))).toEqual([["YAML", "Hashtags"], ["Flat", "Nested"], ["Copy", "Link", "Leave out"]]);
    expect(decision.questions.map((each) => each.recommended)).toEqual(["YAML", "Nested", "Link"]);
    expect(decision.questions[2]?.options[1]).toMatchObject({ label: "Link", prompt: "Use Link" });
    expect(decision.question).toBe("3 questions: Tags · Folders · Images");
    expect(decision.options).toEqual([]);
  });

  it("one question in questions parses as a single decision", () => {
    const decision = parseDecisionBody(block(question("Tags", ["YAML", "Hashtags"])));
    expect(decision).toMatchObject({ id: "export", blocking: true, question: "Tags as?", recommended: "YAML", reason: "it fits", questions: [], problems: [] });
    expect(decision.options.map((option) => option.label)).toEqual(["YAML", "Hashtags"]);
  });

  it("refuses five questions", () => {
    const decision = parseDecisionBody(block(...["A", "B", "C", "D", "E"].map((header) => question(header, ["Yes", "No"]))));
    expect(decision.problems.some((problem) => problem.includes("5 questions"))).toBe(true);
  });

  it("refuses a missing header", () => {
    const decision = parseDecisionBody(block(question("Tags", ["YAML"]), question("Folders", ["Flat"]).replace("  - header: Folders\n    question", "  - question")));
    expect(decision.problems).toContain("question 2 has no header");
  });

  it("refuses a duplicate header", () => {
    expect(parseDecisionBody(block(question("Tags", ["YAML"]), question("Tags", ["Flat"]))).problems).toContain('two questions have the header "Tags"');
  });

  it("refuses question and questions together", () => {
    const decision = parseDecisionBody(`question: Which?\n${block(question("Tags", ["YAML"]), question("Folders", ["Flat"]))}`);
    expect(decision.problems.some((problem) => problem.startsWith("both question and questions"))).toBe(true);
  });

  it("refuses a default on several questions", () => {
    const decision = parseDecisionBody(`default: YAML\n${block(question("Tags", ["YAML"]), question("Folders", ["Flat"]))}`);
    expect(decision.problems.some((problem) => problem.startsWith("a default on several questions"))).toBe(true);
    expect(decision.default).toBe("");
  });

  it("refuses a question with no options and a header past 24 characters", () => {
    const decision = parseDecisionBody(block(question("Tags", ["YAML"]), question("A header far too long for its tab", []).replace("    options:\n", "")));
    expect(decision.problems).toContain('question "A header far too long for its tab": no options');
    expect(decision.problems).toContain('header "A header far too long for its tab" is longer than 24 characters');
  });

  it("keeps a long why as a block scalar in a question", () => {
    const why = "    why: |\n      Front matter is read by site tools.\n\n      Hashtags read better in plain editors.";
    const decision = parseDecisionBody(block(question("Tags", ["YAML"]).replace("    options:", `${why}\n    options:`), question("Folders", ["Flat"])));
    expect(decision.problems).toEqual([]);
    expect(decision.questions[0]?.why).toBe("Front matter is read by site tools.\n\nHashtags read better in plain editors.");
    expect(decision.questions[0]?.options[0]?.label).toBe("YAML");
  });

  it("reads the example in skill/reference/formats.md without a problem", () => {
    const formats = readFileSync(join(__dirname, "..", "skill", "reference", "formats.md"), "utf8");
    const example = /```decision\n(id: export-format[\s\S]*?)```/.exec(formats)?.[1] ?? "";
    const decision = parseDecisionBody(example);
    expect(decision.problems).toEqual([]);
    expect(decision.questions.map((each) => each.header)).toEqual(["Tag format", "Attachments"]);
  });

  it("reads several questions written as JSON", () => {
    const body = JSON.stringify({
      id: "export",
      blocking: true,
      questions: [
        { header: "Tags", question: "Tags as?", options: [{ label: "YAML", prompt: "Use YAML" }], recommended: "YAML", reason: "fits" },
        { header: "Folders", question: "Layout?", options: [{ label: "Flat", prompt: "One folder" }], recommended: "Flat", reason: "fits" },
      ],
    });
    const decision = parseDecisionBody(body);
    expect(decision.problems).toEqual([]);
    expect(decision.questions.map((each) => each.header)).toEqual(["Tags", "Folders"]);
  });

  it("a block asked again with other questions is not the same question", () => {
    const first = parseDecisionBody(block(question("Tags", ["YAML"]), question("Folders", ["Flat"])));
    const second = parseDecisionBody(block(question("Tags", ["YAML"]), question("Folders", ["Nested"])));
    expect(sameQuestion(first, first)).toBe(true);
    expect(sameQuestion(first, second)).toBe(false);
  });
});
