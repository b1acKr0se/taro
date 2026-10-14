import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ATTACHMENTS, MAX_IMAGE_BASE64_LENGTH } from "../shared/attachments";
import type { PaseoApi } from "./host-types";
import { hasAttachments, sendWithAttachments } from "./uploads";

/** Makes the n-th `writeFile` fail, to stand for a disk error in the middle of a message's files. */
const failWrite = vi.hoisted(() => ({ at: -1, count: 0 }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      failWrite.count += 1;
      if (failWrite.count === failWrite.at) throw new Error("ENOSPC: no space left on device");
      return actual.writeFile(...args);
    },
  };
});

interface Sent {
  agentId: string;
  text: string;
  options: { images?: unknown[]; attachments?: { type: string; id: string; fileName: string; mimeType: string; size: number; path: string }[]; activeTurnBehavior?: string };
}

let home: string;
let sent: Sent[];
let sendFails: boolean;
let paseo: PaseoApi;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-uploads-"));
  sent = [];
  sendFails = false;
  failWrite.at = -1;
  failWrite.count = 0;
  paseo = {
    agents: {
      ref: (agentId: string) => ({
        send: async (text: string, options: Sent["options"]) => {
          if (sendFails) throw new Error("agent not found");
          sent.push({ agentId, text, options });
        },
      }),
    },
  } as unknown as PaseoApi;
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const base64 = (text: string) => Buffer.from(text).toString("base64");

async function uploads(): Promise<string[]> {
  return readdir(join(home, "uploads")).catch(() => []);
}

describe("sendWithAttachments", () => {
  it("sends plain words with nothing extra, joining a running turn", async () => {
    await sendWithAttachments(paseo, "agent-1", "hello", {}, home);
    expect(sent).toEqual([{ agentId: "agent-1", text: "hello", options: { activeTurnBehavior: "steer" } }]);
    expect(await uploads()).toEqual([]);
  });

  it("passes images through as the message's images", async () => {
    const images = [{ mimeType: "image/png", data: base64("png bytes") }];
    await sendWithAttachments(paseo, "agent-1", "", { images, files: [] }, home);
    expect(sent[0]).toEqual({ agentId: "agent-1", text: "", options: { images, activeTurnBehavior: "steer" } });
  });

  it("sends with the chat's own message id, so the chat finds the message in the timeline", async () => {
    await sendWithAttachments(paseo, "agent-1", "hello", { messageId: "chat-abc-1" }, home);
    expect(sent[0]).toEqual({ agentId: "agent-1", text: "hello", options: { messageId: "chat-abc-1", activeTurnBehavior: "steer" } });
  });

  it("writes each file where Paseo keeps uploads and names it as an uploaded_file", async () => {
    await sendWithAttachments(
      paseo,
      "agent-1",
      "",
      {
        files: [
          { fileName: "notes.txt", mimeType: "text/plain", data: base64("first file") },
          { fileName: "notes.txt", mimeType: "", data: base64("second, same name") },
        ],
      },
      home,
    );
    const attachments = sent[0]?.options.attachments ?? [];
    expect(sent[0]?.options.images).toBeUndefined();
    expect(attachments).toHaveLength(2);
    const [first, second] = attachments;
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
    await sendWithAttachments(paseo, "agent-1", "x", { files: [{ fileName: "../../escape.sh", mimeType: "text/x-sh", data: base64("x") }] }, home);
    const file = sent[0]?.options.attachments?.[0];
    expect(file?.fileName).toBe("escape.sh");
    expect(dirname(dirname(file?.path ?? ""))).toBe(join(home, "uploads"));
  });

  it("writes a long name in any script within the file system's 255 bytes", async () => {
    await sendWithAttachments(paseo, "agent-1", "x", { files: [{ fileName: `${"報告".repeat(55)}.pdf`, mimeType: "application/pdf", data: base64("pdf") }] }, home);
    const file = sent[0]?.options.attachments?.[0];
    expect(Buffer.byteLength(file?.fileName ?? "")).toBeLessThanOrEqual(255);
    expect(file?.fileName.endsWith(".pdf")).toBe(true);
    expect(await readFile(file?.path ?? "", "utf8")).toBe("pdf");
  });

  it("sends images and files together", async () => {
    await sendWithAttachments(paseo, "agent-1", "both", { images: [{ mimeType: "image/jpeg", data: base64("jpg") }], files: [{ fileName: "a.csv", mimeType: "text/csv", data: base64("1,2") }] }, home);
    expect(sent[0]?.options.images).toHaveLength(1);
    expect(sent[0]?.options.attachments).toHaveLength(1);
  });

  it("refuses too many attachments before writing or sending anything", async () => {
    const files = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, index) => ({ fileName: `f${index}.txt`, mimeType: "text/plain", data: base64("x") }));
    await expect(sendWithAttachments(paseo, "agent-1", "x", { files }, home)).rejects.toThrow(/at most/);
    expect(await uploads()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("refuses an image over the provider's limit before writing or sending anything, but not a file that large (TR-037)", async () => {
    const large = "A".repeat(MAX_IMAGE_BASE64_LENGTH + 4);
    const file = { fileName: "a.txt", mimeType: "text/plain", data: base64("x") };
    await expect(sendWithAttachments(paseo, "agent-1", "x", { images: [{ mimeType: "image/jpeg", data: large }], files: [file] }, home)).rejects.toThrow(/could not be made smaller/);
    expect(await uploads()).toEqual([]);
    expect(sent).toEqual([]);
    await sendWithAttachments(paseo, "agent-1", "x", { images: [{ mimeType: "image/jpeg", data: "A".repeat(MAX_IMAGE_BASE64_LENGTH) }], files: [{ ...file, data: large }] }, home);
    expect(sent).toHaveLength(1);
  });

  it("removes the files it wrote when the send fails, so a retry leaves no orphan", async () => {
    sendFails = true;
    const files = [
      { fileName: "a.txt", mimeType: "text/plain", data: base64("a") },
      { fileName: "b.txt", mimeType: "text/plain", data: base64("b") },
    ];
    await expect(sendWithAttachments(paseo, "agent-1", "x", { files }, home)).rejects.toThrow("agent not found");
    expect(await uploads()).toEqual([]);
  });

  it("removes every file of the message when one write fails, and sends nothing", async () => {
    failWrite.at = 2;
    const files = ["a", "b", "c"].map((name) => ({ fileName: `${name}.txt`, mimeType: "text/plain", data: base64(name) }));
    await expect(sendWithAttachments(paseo, "agent-1", "x", { files }, home)).rejects.toThrow(/ENOSPC/);
    expect(await uploads()).toEqual([]);
    expect(sent).toEqual([]);
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
