import { describe, expect, it } from "vitest";

import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BASE64_LENGTH,
  attachmentGallery,
  attachmentProblem,
  imageTooLarge,
  oversizedImageProblem,
  refuseOversizedImages,
  base64ByteLength,
  formatBytes,
  imageFileName,
  outgoingAttachments,
  parseDataUrl,
  safeFileName,
  utf8Length,
  type DraftAttachment,
} from "./attachments";

const base64 = (text: string) => Buffer.from(text).toString("base64");

describe("base64ByteLength", () => {
  it("is the decoded size, padding or not", () => {
    expect(base64ByteLength("")).toBe(0);
    expect(base64ByteLength(base64("a"))).toBe(1);
    expect(base64ByteLength(base64("ab"))).toBe(2);
    expect(base64ByteLength(base64("abc"))).toBe(3);
    expect(base64ByteLength(base64("hello world!!"))).toBe(13);
  });

  it("ignores line breaks inside the data", () => {
    expect(base64ByteLength(`${base64("abc")}\n${base64("def")}`)).toBe(6);
  });
});

describe("attachmentProblem", () => {
  it("allows none, one, and exactly the maximum", () => {
    expect(attachmentProblem([])).toBeNull();
    expect(attachmentProblem([{ data: base64("x") }])).toBeNull();
    expect(attachmentProblem(Array.from({ length: MAX_ATTACHMENTS }, () => ({ data: base64("x") })))).toBeNull();
  });

  it("refuses one attachment too many", () => {
    expect(attachmentProblem(Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({ data: "" })))).toMatch(/at most 10/);
  });

  it("refuses a total just over the size limit, not one exactly at it", () => {
    const exact = "A".repeat((MAX_ATTACHMENT_BYTES / 3) * 4);
    expect(base64ByteLength(exact)).toBe(MAX_ATTACHMENT_BYTES);
    expect(attachmentProblem([{ data: exact }])).toBeNull();
    expect(attachmentProblem([{ data: exact }, { data: base64("abc") }])).toMatch(/over 30.0 MB/);
  });
});

describe("the per-image limit (TR-037)", () => {
  const atLimit = "A".repeat(MAX_IMAGE_BASE64_LENGTH);
  const overLimit = "A".repeat(MAX_IMAGE_BASE64_LENGTH + 4);

  it("counts the encoded length, allowing exactly the limit and refusing one block more", () => {
    expect(imageTooLarge({ data: "" })).toBe(false);
    expect(imageTooLarge({ data: atLimit })).toBe(false);
    expect(imageTooLarge({ data: overLimit })).toBe(true);
    // Line breaks are not sent, so they do not count.
    expect(imageTooLarge({ data: `${atLimit.slice(0, 10)}\n${atLimit.slice(10)}` })).toBe(false);
  });

  it("names the image, its size and the limit in decoded megabytes", () => {
    expect(oversizedImageProblem({ data: overLimit, fileName: "IMG_1.HEIC" })).toBe("“IMG_1.HEIC” is 3.8 MB and could not be made smaller; an agent takes images of at most 3.8 MB.");
    expect(oversizedImageProblem({ data: "A".repeat(8 * 1024 * 1024) })).toMatch(/^An image is 6.0 MB/);
  });

  it("refuses an oversized image in a message, but never a file of that size", () => {
    expect(attachmentProblem([{ kind: "image", data: atLimit }])).toBeNull();
    expect(attachmentProblem([{ kind: "file", data: overLimit }])).toBeNull();
    expect(attachmentProblem([{ data: overLimit }])).toBeNull();
    expect(attachmentProblem([{ kind: "file", data: "" }, { kind: "image", fileName: "b.png", data: overLimit }])).toMatch(/^“b.png” is/);
  });

  it("keeps what fits, in order, and says why the rest was left out", () => {
    const list = [
      { kind: "image" as const, fileName: "big.jpg", data: overLimit },
      { kind: "image" as const, fileName: "small.jpg", data: "AA==" },
      { kind: "file" as const, fileName: "large.zip", data: overLimit },
      { kind: "image" as const, fileName: "big2.jpg", data: overLimit },
    ];
    const { fitting, problem } = refuseOversizedImages(list);
    expect(fitting.map((item) => item.fileName)).toEqual(["small.jpg", "large.zip"]);
    expect(problem).toMatch(/^“big.jpg” is .* at most 3.8 MB\. 1 more image was left out too\.$/);
    expect(refuseOversizedImages(["a.jpg", "b.jpg", "c.jpg"].map((fileName) => ({ kind: "image" as const, fileName, data: overLimit }))).problem).toMatch(/ 2 more images were left out too\.$/);
    expect(refuseOversizedImages([])).toEqual({ fitting: [], problem: null });
    expect(refuseOversizedImages(list.slice(1, 3))).toEqual({ fitting: list.slice(1, 3), problem: null });
  });
});

describe("attachmentGallery", () => {
  it("lists the draft's images in order, drawn from their data and named by file, without the files", () => {
    const list: DraftAttachment[] = [
      { id: "1", kind: "image", fileName: "first screen.png", mimeType: "image/png", data: "AA==" },
      { id: "2", kind: "file", fileName: "notes.txt", mimeType: "text/plain", data: "Ag==" },
      { id: "3", kind: "image", fileName: "photo.jpg", mimeType: "image/jpeg", data: "/9j/" },
    ];
    expect(attachmentGallery(list)).toEqual([
      { id: "1", source: "data:image/png;base64,AA==", alt: "first screen.png" },
      { id: "3", source: "data:image/jpeg;base64,/9j/", alt: "photo.jpg" },
    ]);
  });

  it("is empty with no images", () => {
    expect(attachmentGallery([])).toEqual([]);
    expect(attachmentGallery([{ id: "1", kind: "file", fileName: "a.pdf", mimeType: "application/pdf", data: "AA==" }])).toEqual([]);
  });
});

describe("outgoingAttachments", () => {
  it("splits images from files, in order, without the composer's ids", () => {
    const list: DraftAttachment[] = [
      { id: "1", kind: "image", fileName: "a.png", mimeType: "image/png", data: "AA==" },
      { id: "2", kind: "file", fileName: "notes.txt", mimeType: "text/plain", data: "Ag==" },
      { id: "3", kind: "image", fileName: "b.jpg", mimeType: "image/jpeg", data: "Aw==" },
    ];
    expect(outgoingAttachments(list)).toEqual({
      images: [
        { mimeType: "image/png", data: "AA==" },
        { mimeType: "image/jpeg", data: "Aw==" },
      ],
      files: [{ fileName: "notes.txt", mimeType: "text/plain", data: "Ag==" }],
    });
    expect(outgoingAttachments([])).toEqual({ images: [], files: [] });
  });
});

describe("parseDataUrl", () => {
  it("reads the type and the base64 content", () => {
    expect(parseDataUrl("data:image/png;base64,iVBOR")).toEqual({ mimeType: "image/png", data: "iVBOR" });
    expect(parseDataUrl("data:text/plain;charset=utf-8;base64,aGk=")).toEqual({ mimeType: "text/plain", data: "aGk=" });
  });

  it("falls back to a generic type when the URL names none", () => {
    expect(parseDataUrl("data:;base64,aGk=")).toEqual({ mimeType: "application/octet-stream", data: "aGk=" });
  });

  it("refuses anything that is not base64 data", () => {
    expect(parseDataUrl("data:text/plain,hello")).toBeNull();
    expect(parseDataUrl("https://example.com/a.png")).toBeNull();
    expect(parseDataUrl("")).toBeNull();
  });
});

describe("safeFileName", () => {
  it("keeps an ordinary name, spaces and Unicode included", () => {
    expect(safeFileName("report.pdf")).toBe("report.pdf");
    expect(safeFileName("Quarterly notes 2026.md")).toBe("Quarterly notes 2026.md");
    expect(safeFileName("résumé.txt")).toBe("résumé.txt");
  });

  it("keeps only the last path segment", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\someone\\notes.txt")).toBe("notes.txt");
  });

  it("replaces what no file system allows", () => {
    expect(safeFileName('a:b*c?"d<e>f|g.txt')).toBe("a_b_c__d_e_f_g.txt");
    expect(safeFileName("line\nbreak.txt")).toBe("line_break.txt");
  });

  it("names an empty or dot-only name 'upload'", () => {
    expect(safeFileName("")).toBe("upload");
    expect(safeFileName("   ")).toBe("upload");
    expect(safeFileName(".")).toBe("upload");
    expect(safeFileName("..")).toBe("upload");
    expect(safeFileName("dir/")).toBe("upload");
  });

  it("keeps a name of exactly 255 bytes, and shortens one byte more to fit, keeping the extension", () => {
    const exact = `${"x".repeat(250)}.json`;
    expect(safeFileName(exact)).toBe(exact);
    const shortened = safeFileName(`${"x".repeat(251)}.json`);
    expect(utf8Length(shortened)).toBe(255);
    expect(shortened.endsWith(".json")).toBe(true);
  });

  it("counts bytes, not characters, for names in other scripts, and never splits a character", () => {
    const chinese = safeFileName(`${"報告".repeat(55)}.pdf`);
    expect(Buffer.byteLength(chinese)).toBeLessThanOrEqual(255);
    expect(Buffer.byteLength(chinese)).toBeGreaterThan(250);
    expect(chinese.endsWith(".pdf")).toBe(true);
    const emoji = safeFileName(`${"😀".repeat(100)}.png`);
    expect(Buffer.byteLength(emoji)).toBeLessThanOrEqual(255);
    expect(emoji).toBe(`${"😀".repeat(62)}.png`);
    expect(emoji.endsWith(".png")).toBe(true);
  });

  it("drops an extension too long to keep", () => {
    const name = safeFileName(`a.${"x".repeat(300)}`);
    expect(utf8Length(name)).toBe(255);
  });
});

describe("imageFileName", () => {
  it("names an image by its type and place", () => {
    expect(imageFileName("image/png", 0)).toBe("image-1.png");
    expect(imageFileName("image/jpeg", 2)).toBe("image-3.jpg");
    expect(imageFileName("image/svg+xml", 0)).toBe("image-1.svg");
    expect(imageFileName("application/octet-stream", 0)).toBe("image-1.bin");
  });
});

describe("utf8Length", () => {
  it("matches the bytes UTF-8 takes, for every width", () => {
    ["", "abc", "é", "報", "😀", "a報😀é"].forEach((text) => expect(utf8Length(text)).toBe(Buffer.byteLength(text)));
  });
});

describe("formatBytes", () => {
  it("picks the unit by size", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
});
