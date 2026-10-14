import { describe, expect, it } from "vitest";

import { blockImages, inlineTexts, parseMarkdown, parseMarkdownCached } from "./markdown-parse";

const SCREENSHOT = "file:///tmp/paseo-attachments-x1/9f%20a.png";

describe("parseMarkdown images", () => {
  it("parses a line that is only an image into an image block", () => {
    expect(parseMarkdown(`![Image](${SCREENSHOT})`)).toEqual([{ kind: "image", images: [{ alt: "Image", src: SCREENSHOT }] }]);
  });

  it("parses several images on one line, whitespace between", () => {
    expect(parseMarkdown("  ![one](https://example.com/1.png)   ![](/tmp/two.png) ")).toEqual([
      {
        kind: "image",
        images: [
          { alt: "one", src: "https://example.com/1.png" },
          { alt: "", src: "/tmp/two.png" },
        ],
      },
    ]);
  });

  it("unescapes \\] in the alt text and \\) in the source", () => {
    expect(parseMarkdown("![a \\[b\\] c](/tmp/x\\(1\\).png)")).toEqual([{ kind: "image", images: [{ alt: "a [b] c", src: "/tmp/x(1).png" }] }]);
  });

  it("ends the paragraph before it and starts a new one after", () => {
    expect(parseMarkdown(`Here it is:\n![Image](${SCREENSHOT})\nLooks right.`)).toEqual([
      { kind: "paragraph", text: "Here it is:" },
      { kind: "image", images: [{ alt: "Image", src: SCREENSHOT }] },
      { kind: "paragraph", text: "Looks right." },
    ]);
  });

  it("keeps an image inside running text as its alt text in brackets, leaving inline code alone", () => {
    expect(parseMarkdown("See ![the chart](/tmp/c.png) and `![raw](x.png)`.")).toEqual([
      { kind: "paragraph", text: "See [the chart] and `![raw](x.png)`." },
    ]);
    expect(parseMarkdown("- item ![pic](/tmp/p.png)")).toEqual([{ kind: "list", items: [{ marker: "•", depth: 0, text: "item [pic]" }] }]);
  });

  it("keeps an image inside fenced code as code", () => {
    expect(parseMarkdown("```\n![Image](/tmp/a.png)\n```")).toEqual([{ kind: "code", text: "![Image](/tmp/a.png)" }]);
  });

  it("finds images inside a quote", () => {
    expect(parseMarkdown("> ![q](/tmp/q.png)")).toEqual([{ kind: "quote", blocks: [{ kind: "image", images: [{ alt: "q", src: "/tmp/q.png" }] }] }]);
  });

  it("gives an image block no inline text", () => {
    expect(inlineTexts(parseMarkdown("![Image](/tmp/a.png)"))).toEqual([]);
  });
});

describe("blockImages", () => {
  it("lists every image of a message in reading order, quotes included", () => {
    const blocks = parseMarkdown("![a](/tmp/a.png)\n\ntext ![inline](/tmp/x.png)\n\n> ![b](/tmp/b.png) ![c](/tmp/c.png)\n\n```\n![code](/tmp/code.png)\n```");
    expect(blockImages(blocks).map((image) => image.src)).toEqual(["/tmp/a.png", "/tmp/b.png", "/tmp/c.png"]);
  });

  it("is empty for a message without images", () => {
    expect(blockImages(parseMarkdown("just words"))).toEqual([]);
    expect(blockImages([])).toEqual([]);
  });
});

describe("parseMarkdownCached", () => {
  it("parses a text once: the same text drawn again gets the same blocks", () => {
    const text = "## Status\n\n- one\n- two\n\n**Done.**";
    const blocks = parseMarkdownCached(text);
    expect(parseMarkdownCached(text)).toBe(blocks);
    expect(blocks).toEqual(parseMarkdown(text));
  });

  it("parses another text afresh", () => {
    expect(parseMarkdownCached("first reply")).not.toBe(parseMarkdownCached("second reply"));
  });

  it("parses the empty text", () => {
    expect(parseMarkdownCached("")).toEqual(parseMarkdown(""));
  });

  it("stays bounded: after many other texts the oldest is parsed again, still to the same blocks", () => {
    const oldest = "an early message";
    const first = parseMarkdownCached(oldest);
    for (let index = 0; index < 700; index += 1) parseMarkdownCached(`message ${index}`);
    const again = parseMarkdownCached(oldest);
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });
});
