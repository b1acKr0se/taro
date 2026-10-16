import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES, readImage, type ImageRoots } from "./images";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let base: string;
let roots: ImageRoots;
let evidence: string;
let images: string;
let attachments: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "taro-images-"));
  evidence = join(base, "data", "evidence");
  images = join(base, "data", "images");
  attachments = join(base, "tmp", "paseo-attachments-abc");
  outside = join(base, "outside");
  await Promise.all([evidence, images, attachments, outside, join(base, "tmp", "other")].map((directory) => mkdir(directory, { recursive: true })));
  roots = { fixed: [evidence, images], attachmentsParent: join(base, "tmp") };
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("readImage", () => {
  it("serves a png from each allowed root, and its base64 round-trips", async () => {
    for (const directory of [evidence, images, attachments]) {
      const path = join(directory, "shot.png");
      await writeFile(path, PNG);
      const image = await readImage(path, roots);
      expect(image?.mimeType).toBe("image/png");
      expect(Buffer.from(image?.data ?? "", "base64").equals(PNG)).toBe(true);
    }
  });

  it("sends the size from the image's header, and none when the header is unreadable", async () => {
    const header = Buffer.alloc(24);
    PNG.copy(header, 0, 0, 8);
    header.writeUInt32BE(1440, 16);
    header.writeUInt32BE(900, 20);
    await writeFile(join(evidence, "sized.png"), header);
    expect(await readImage(join(evidence, "sized.png"), roots)).toMatchObject({ mimeType: "image/png", width: 1440, height: 900 });
    await writeFile(join(evidence, "shot.png"), PNG);
    const unsized = await readImage(join(evidence, "shot.png"), roots);
    expect(unsized).not.toBeNull();
    expect(unsized).not.toHaveProperty("width");
    expect(unsized).not.toHaveProperty("height");
  });

  it("refuses a path outside the allowed roots, including a tmp directory not named paseo-attachments-*", async () => {
    await writeFile(join(outside, "shot.png"), PNG);
    await writeFile(join(base, "tmp", "other", "shot.png"), PNG);
    expect(await readImage(join(outside, "shot.png"), roots)).toBeNull();
    expect(await readImage(join(base, "tmp", "other", "shot.png"), roots)).toBeNull();
  });

  it("refuses a symlink inside a root that points outside", async () => {
    await writeFile(join(outside, "secret.png"), PNG);
    await symlink(join(outside, "secret.png"), join(evidence, "link.png"));
    expect(await readImage(join(evidence, "link.png"), roots)).toBeNull();
  });

  it("refuses a `..` path escaping a root", async () => {
    await writeFile(join(outside, "shot.png"), PNG);
    expect(await readImage(`${evidence}/../../outside/shot.png`, roots)).toBeNull();
  });

  it("refuses a non-image extension", async () => {
    await writeFile(join(evidence, "notes.txt"), "hello");
    expect(await readImage(join(evidence, "notes.txt"), roots)).toBeNull();
  });

  it("refuses a file over 8 MB", async () => {
    await writeFile(join(evidence, "big.png"), Buffer.alloc(MAX_IMAGE_BYTES + 1));
    expect(await readImage(join(evidence, "big.png"), roots)).toBeNull();
  });

  it("refuses a missing file and a relative path", async () => {
    expect(await readImage(join(evidence, "missing.png"), roots)).toBeNull();
    expect(await readImage("shot.png", roots)).toBeNull();
  });

  it("accepts a file:// URI with %-encoded segments", async () => {
    await writeFile(join(attachments, "a shot é.png"), PNG);
    const uri = pathToFileURL(join(attachments, "a shot é.png")).href;
    expect(uri).toContain("%20");
    expect((await readImage(uri, roots))?.mimeType).toBe("image/png");
  });
});
