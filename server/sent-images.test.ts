import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claudeSessionPath, readSentImages } from "./sent-images";

const RED = Buffer.from("red pixel").toString("base64");
const BLUE = Buffer.from("blue pixel").toString("base64");

function image(data: string, mediaType = "image/png") {
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

function user(content: unknown) {
  return JSON.stringify({ type: "user", message: { role: "user", content } });
}

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "taro-sent-images-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function session(lines: string[]): Promise<string> {
  const path = join(base, "session.jsonl");
  await writeFile(path, `${lines.join("\n")}\n`);
  return path;
}

describe("readSentImages", () => {
  it("reads a session again once it has grown", async () => {
    const path = await session([user([{ type: "text", text: "first" }, image(RED)])]);
    const directory = join(base, "images");
    expect((await readSentImages(path, directory)).map((message) => message.text)).toEqual(["first"]);
    await appendFile(path, `${user([{ type: "text", text: "second" }, image(BLUE)])}\n`);
    expect((await readSentImages(path, directory)).map((message) => message.text)).toEqual(["first", "second"]);
  });

  it("returns only the user's messages with images, in order, text joined and trimmed", async () => {
    const path = await session([
      user("plain words, no blocks"),
      user([{ type: "text", text: " Look at this " }, { type: "text", text: "and this " }, image(RED)]),
      "{ not json",
      JSON.stringify({ type: "assistant", message: { content: [image(RED)] } }),
      user([{ type: "tool_result", tool_use_id: "t1", content: [image(BLUE)] }]),
      user([image(BLUE, "image/jpeg")]),
      user([{ type: "text", text: "same" }, image(RED)]),
      user([{ type: "text", text: "same" }, image(BLUE, "image/jpeg")]),
    ]);
    const images = join(base, "images");
    const messages = await readSentImages(path, images);
    const redPath = join(images, `${createHash("sha256").update(Buffer.from(RED, "base64")).digest("hex")}.png`);
    const bluePath = join(images, `${createHash("sha256").update(Buffer.from(BLUE, "base64")).digest("hex")}.jpg`);
    expect(messages).toEqual([
      { text: "Look at this \nand this", images: [{ path: redPath, mimeType: "image/png" }] },
      { text: "", images: [{ path: bluePath, mimeType: "image/jpeg" }] },
      { text: "same", images: [{ path: redPath, mimeType: "image/png" }] },
      { text: "same", images: [{ path: bluePath, mimeType: "image/jpeg" }] },
    ]);
    expect((await readdir(images)).sort()).toHaveLength(2);
  });

  it("keeps a message without images whose words match one with images, so repeats count right", async () => {
    const path = await session([user([{ type: "text", text: "look" }, image(RED)]), user("look"), user("other words")]);
    const images = join(base, "images");
    const redPath = join(images, `${createHash("sha256").update(Buffer.from(RED, "base64")).digest("hex")}.png`);
    expect(await readSentImages(path, images)).toEqual([
      { text: "look", images: [{ path: redPath, mimeType: "image/png" }] },
      { text: "look", images: [] },
    ]);
  });

  it("reads a line the agent was still writing once its newline arrives", async () => {
    const path = join(base, "session.jsonl");
    const line = user([{ type: "text", text: "half" }, image(RED)]);
    await writeFile(path, line.slice(0, 20));
    const directory = join(base, "images");
    expect(await readSentImages(path, directory)).toEqual([]);
    await appendFile(path, `${line.slice(20)}\n`);
    expect((await readSentImages(path, directory)).map((message) => message.text)).toEqual(["half"]);
  });

  it("reads a file that shrank again from the start", async () => {
    const path = await session([user([{ type: "text", text: "one" }, image(RED)]), user([{ type: "text", text: "two" }, image(BLUE)])]);
    const directory = join(base, "images");
    expect(await readSentImages(path, directory)).toHaveLength(2);
    await writeFile(path, `${user([{ type: "text", text: "three" }, image(RED)])}\n`);
    expect((await readSentImages(path, directory)).map((message) => message.text)).toEqual(["three"]);
  });

  it("does not rewrite an image already stored", async () => {
    const path = await session([user([image(RED)])]);
    const images = join(base, "images");
    const [first] = await readSentImages(path, images);
    const stored = first?.images[0]?.path ?? "";
    const before = (await stat(stored)).mtimeMs;
    await new Promise((settle) => setTimeout(settle, 20));
    await readSentImages(path, images);
    expect((await stat(stored)).mtimeMs).toBe(before);
  });

  it("returns nothing for a missing session file", async () => {
    expect(await readSentImages(join(base, "missing.jsonl"), join(base, "images"))).toEqual([]);
  });
});

describe("claudeSessionPath", () => {
  it("names the project directory with every character outside [A-Za-z0-9] as -", () => {
    expect(claudeSessionPath("/home/someone/my_repo.v2", "abc", "/config")).toBe("/config/projects/-home-someone-my-repo-v2/abc.jsonl");
  });
});
