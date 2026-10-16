import { describe, expect, it } from "vitest";

import { heldWhileWriting } from "./streaming-text";

const shown = (text: string) => ({ text, asking: false });
const asking = (text: string) => ({ text, asking: true });

describe("heldWhileWriting", () => {
  it("leaves a reply with nothing unfinished as it is", () => {
    expect(heldWhileWriting("")).toEqual(shown(""));
    expect(heldWhileWriting("The notes app has two files.")).toEqual(shown("The notes app has two files."));
    expect(heldWhileWriting("Plan:\n\n- read\n- write\n")).toEqual(shown("Plan:\n\n- read\n- write\n"));
  });

  it("leaves out an unclosed decision block, and all after it, and says a question is coming", () => {
    expect(heldWhileWriting("I need one answer.\n\n```decision\nid: fee-storage\nquestion: Store fees per")).toEqual(asking("I need one answer."));
    expect(heldWhileWriting("```decision\n")).toEqual(asking(""));
    expect(heldWhileWriting("```decision")).toEqual(asking(""));
  });

  it("keeps a closed block, and holds a second one still open", () => {
    const closed = "A.\n\n```decision\nid: a\nquestion: b\n```\n\nThen more.";
    expect(heldWhileWriting(closed)).toEqual(shown(closed));
    expect(heldWhileWriting(`${closed}\n\n\`\`\`decision\nid: c`)).toEqual(asking(closed));
  });

  it("holds the start of a block's opening fence, but not another code block", () => {
    expect(heldWhileWriting("Here it is.\n\n```dec")).toEqual(shown("Here it is."));
    expect(heldWhileWriting("Here it is.\n\n```")).toEqual(shown("Here it is."));
    expect(heldWhileWriting("Here it is.\n\n``")).toEqual(shown("Here it is.\n\n``"));
    expect(heldWhileWriting("Run this:\n\n```sh\nnpm test")).toEqual(shown("Run this:\n\n```sh\nnpm test"));
  });

  it("leaves out a last line that is, or may become, a status line", () => {
    expect(heldWhileWriting("All done.\n\nwaiting: approval of")).toEqual(shown("All done."));
    expect(heldWhileWriting("All done.\n\ndo")).toEqual(shown("All done."));
    expect(heldWhileWriting("All done.\n\nfailed:")).toEqual(shown("All done."));
    expect(heldWhileWriting("done: merged")).toEqual(shown(""));
  });

  it("keeps a last line that cannot be a status line, and one already finished by a line break", () => {
    expect(heldWhileWriting("All done.\n\ndoing the rest")).toEqual(shown("All done.\n\ndoing the rest"));
    expect(heldWhileWriting("All done.\n\nwe found")).toEqual(shown("All done.\n\nwe found"));
    expect(heldWhileWriting("Status: green")).toEqual(shown("Status: green"));
    expect(heldWhileWriting("All done.\n\ndone: merged\n")).toEqual(shown("All done.\n\ndone: merged\n"));
  });
});
