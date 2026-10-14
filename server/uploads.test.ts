import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_ATTACHMENTS } from "../shared/attachments";
import { attachmentExtras, hasAttachments } from "./uploads";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-uploads-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const base64 = (text: string) => Buffer.from(text).toString("base64");

describe("attachmentExtras", () => {
  it("sends nothing extra for no attachments", async () => {
    expect(await attachmentExtras({}, home)).toEqual({});
    expect(await attachmentExtras({ images: [], files: [] }, home)).toEqual({});
    await expect(readdir(join(home, "uploads"))).rejects.toThrow();
  });

  it("passes images through as the message's images", async () => {
    const images = [{ mimeType: "image/png", data: base64("png bytes") }];
    expect(await attachmentExtras({ images }, home)).toEqual({ images });
  });

  it("writes each file where Paseo keeps uploads and names it as an uploaded_file", async () => {
    const extras = await attachmentExtras(
      {
        files: [
          { fileName: "notes.txt", mimeType: "text/plain", data: base64("first file") },
          { fileName: "notes.txt", mimeType: "", data: base64("second, same name") },
        ],
      },
      home,
    );
    const attachments = extras.attachments ?? [];
    expect(attachments).toHaveLength(2);
    const [first, second] = attachments as { type: string; id: string; fileName: string; mimeType: string; size: number; path: string }[];
    expect(first).toMatchObject({ type: "uploaded_file", fileName: "notes.txt", mimeType: "text/plain", size: 10 });
    expect(first?.id).toMatch(/^upload_[0-9a-f-]{36}$/);
    expect(first?.path).toBe(join(home, "uploads", first?.id ?? "", "notes.txt"));
    expect(await readFile(first?.path ?? "", "utf8")).toBe("first file");
    // The same name twice lands in two directories, and an unknown type gets a generic one.
    expect(dirname(second?.path ?? "")).not.toBe(dirname(first?.path ?? ""));
    expect(second?.mimeType).toBe("application/octet-stream");
    expect(await readFile(second?.path ?? "", "utf8")).toBe("second, same name");
  });

  it("keeps a file inside its upload directory whatever its name says", async () => {
    const extras = await attachmentExtras({ files: [{ fileName: "../../escape.sh", mimeType: "text/x-sh", data: base64("x") }] }, home);
    const [file] = (extras.attachments ?? []) as { path: string; fileName: string }[];
    expect(file?.fileName).toBe("escape.sh");
    expect(dirname(dirname(file?.path ?? ""))).toBe(join(home, "uploads"));
  });

  it("sends images and files together", async () => {
    const extras = await attachmentExtras({ images: [{ mimeType: "image/jpeg", data: base64("jpg") }], files: [{ fileName: "a.csv", mimeType: "text/csv", data: base64("1,2") }] }, home);
    expect(extras.images).toHaveLength(1);
    expect(extras.attachments).toHaveLength(1);
  });

  it("refuses too many attachments before writing anything", async () => {
    const files = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, index) => ({ fileName: `f${index}.txt`, mimeType: "text/plain", data: base64("x") }));
    await expect(attachmentExtras({ files }, home)).rejects.toThrow(/at most/);
    await expect(readdir(join(home, "uploads"))).rejects.toThrow();
  });
});

describe("hasAttachments", () => {
  it("is true only when an image or a file is there", () => {
    expect(hasAttachments({})).toBe(false);
    expect(hasAttachments({ images: [], files: [] })).toBe(false);
    expect(hasAttachments({ images: [{ mimeType: "image/png", data: "" }] })).toBe(true);
    expect(hasAttachments({ files: [{ fileName: "a", mimeType: "", data: "" }] })).toBe(true);
  });
});
