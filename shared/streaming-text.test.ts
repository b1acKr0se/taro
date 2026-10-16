import { describe, expect, it } from "vitest";

import { heldWhileWriting, WRITING_A_QUESTION } from "./streaming-text";

describe("heldWhileWriting", () => {
  it("leaves a reply with nothing unfinished as it is", () => {
    expect(heldWhileWriting("")).toBe("");
    expect(heldWhileWriting("The notes app has two files.")).toBe("The notes app has two files.");
    expect(heldWhileWriting("Plan:\n\n- read\n- write\n")).toBe("Plan:\n\n- read\n- write\n");
  });

  it("shows an unclosed decision block, and all after it, as a quiet line", () => {
    const text = "I need one answer.\n\n```decision\nid: fee-storage\nquestion: Store fees per";
    expect(heldWhileWriting(text)).toBe(`I need one answer.\n\n${WRITING_A_QUESTION}`);
    expect(heldWhileWriting("```decision\n")).toBe(WRITING_A_QUESTION);
    expect(heldWhileWriting("```decision")).toBe(WRITING_A_QUESTION);
  });

  it("keeps a closed block, and holds a second one still open", () => {
    const closed = "A.\n\n```decision\nid: a\nquestion: b\n```\n\nThen more.";
    expect(heldWhileWriting(closed)).toBe(closed);
    expect(heldWhileWriting(`${closed}\n\n\`\`\`decision\nid: c`)).toBe(`${closed}\n\n${WRITING_A_QUESTION}`);
  });

  it("holds the start of a block's opening fence, but not another code block", () => {
    expect(heldWhileWriting("Here it is.\n\n```dec")).toBe("Here it is.");
    expect(heldWhileWriting("Here it is.\n\n```")).toBe("Here it is.");
    expect(heldWhileWriting("Here it is.\n\n``")).toBe("Here it is.\n\n``");
    expect(heldWhileWriting("Run this:\n\n```sh\nnpm test")).toBe("Run this:\n\n```sh\nnpm test");
  });

  it("leaves out a last line that is, or may become, a status line", () => {
    expect(heldWhileWriting("All done.\n\nwaiting: approval of")).toBe("All done.");
    expect(heldWhileWriting("All done.\n\ndo")).toBe("All done.");
    expect(heldWhileWriting("All done.\n\nfailed:")).toBe("All done.");
    expect(heldWhileWriting("done: merged")).toBe("");
  });

  it("keeps a last line that cannot be a status line, and one already finished by a line break", () => {
    expect(heldWhileWriting("All done.\n\ndoing the rest")).toBe("All done.\n\ndoing the rest");
    expect(heldWhileWriting("All done.\n\nwe found")).toBe("All done.\n\nwe found");
    expect(heldWhileWriting("Status: green")).toBe("Status: green");
    expect(heldWhileWriting("All done.\n\ndone: merged\n")).toBe("All done.\n\ndone: merged\n");
  });
});
