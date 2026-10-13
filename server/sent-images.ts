/**
 * Images the user sent an agent. Paseo's timeline keeps only a message's words, so for a Claude
 * agent they are read back from Claude's session file and copied, once per content, into the
 * plugin's images directory, where `taro.image.read` serves them.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { sentImagesDirectory } from "./data-dir";
import type { PaseoApi } from "./host-types";

/** A line longer than this is skipped; a message's images are capped by Paseo well under it. */
const MAX_LINE_BYTES = 32 * 1024 * 1024;

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export interface SentImage {
  path: string;
  mimeType: string;
}

export interface SentImagesMessage {
  text: string;
  images: SentImage[];
}

/** Claude's per-project directory name: every character outside [A-Za-z0-9] becomes "-". */
export function claudeProjectDirectoryName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

export function claudeSessionPath(cwd: string, sessionId: string, configDirectory = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")): string {
  return join(configDirectory, "projects", claudeProjectDirectoryName(cwd), `${sessionId}.jsonl`);
}

interface ParsedMessage {
  text: string;
  images: { mimeType: string; data: string }[];
}

/**
 * A session line as a message the user sent (with its images, possibly none), or null for anything
 * else: other record types, tool results (which Claude files as user lines), unreadable lines.
 */
export function userMessageOf(line: string): ParsedMessage | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof record !== "object" || record === null) return null;
  const { type, message } = record as { type?: unknown; message?: unknown };
  if (type !== "user" || typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return { text: content.trim(), images: [] };
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  const images: ParsedMessage["images"] = [];
  let toolResult = false;
  content.forEach((block: unknown) => {
    if (typeof block !== "object" || block === null) return;
    const { type: kind, text, source } = block as { type?: unknown; text?: unknown; source?: unknown };
    if (kind === "tool_result") toolResult = true;
    if (kind === "text" && typeof text === "string") texts.push(text);
    if (kind !== "image" || typeof source !== "object" || source === null) return;
    const { type: sourceType, media_type: mediaType, data } = source as { type?: unknown; media_type?: unknown; data?: unknown };
    if (sourceType === "base64" && typeof mediaType === "string" && typeof data === "string" && EXTENSIONS[mediaType] !== undefined) {
      images.push({ mimeType: mediaType, data });
    }
  });
  if (toolResult || (texts.length === 0 && images.length === 0)) return null;
  // As Paseo's timeline has it (`submittedPromptText`), so the client can match the two.
  return { text: texts.join("\n").trim(), images };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Writes the image under its content hash unless it is already there; returns its path. */
async function storeImage(directory: string, mimeType: string, data: string): Promise<string> {
  const bytes = Buffer.from(data, "base64");
  const path = join(directory, `${createHash("sha256").update(bytes).digest("hex")}.${EXTENSIONS[mimeType] ?? "bin"}`);
  if (!(await exists(path))) {
    await mkdir(directory, { recursive: true });
    await writeFile(path, bytes);
  }
  return path;
}

/** How far each session file has been read, and every user message in it so far. */
interface SessionRead {
  offset: number;
  messages: SentImagesMessage[];
}

const reads = new Map<string, Promise<SessionRead>>();

/**
 * The user's messages in a Claude session file that matter for its images, in order: every message
 * whose words equal those of a message that carried images, with `images: []` where it had none, so
 * the client can count repeated words; none when the file is missing. Claude appends to the file at
 * every step and the chat asks again whenever its timeline grows, so only the appended bytes are
 * read; a file that shrank is read again from the start.
 */
export async function readSentImages(sessionPath: string, directory = sentImagesDirectory()): Promise<SentImagesMessage[]> {
  const key = `${sessionPath}\n${directory}`;
  // One read per file at a time: two would both append the same new lines.
  const next = (reads.get(key) ?? Promise.resolve({ offset: 0, messages: [] })).catch(() => ({ offset: 0, messages: [] })).then((previous) => readOn(sessionPath, directory, previous));
  reads.set(key, next);
  const read = await next;
  const withImages = new Set(read.messages.filter((message) => message.images.length > 0).map((message) => message.text));
  return read.messages.filter((message) => withImages.has(message.text));
}

async function readOn(sessionPath: string, directory: string, previous: SessionRead): Promise<SessionRead> {
  const info = await stat(sessionPath).catch(() => null);
  if (info === null) return { offset: 0, messages: [] };
  const start = info.size < previous.offset ? { offset: 0, messages: [] } : previous;
  if (info.size === start.offset) return start;
  const messages = [...start.messages];
  let offset = start.offset;
  let pending: Buffer = Buffer.alloc(0);
  // Bytes, not characters, so the offset stays exact; a last line without its newline waits for the next read.
  for await (const chunk of createReadStream(sessionPath, { start: offset }) as AsyncIterable<Buffer>) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
    let newline = pending.indexOf(10);
    while (newline >= 0) {
      const line = pending.subarray(0, newline);
      offset += newline + 1;
      pending = pending.subarray(newline + 1);
      const message = line.length > MAX_LINE_BYTES ? null : await messageOf(line.toString("utf8"), directory);
      if (message !== null) messages.push(message);
      newline = pending.indexOf(10);
    }
    // A line too long to keep is skipped whole, without holding it.
    if (pending.length > MAX_LINE_BYTES) {
      const rest = await skipLine(sessionPath, offset);
      offset = rest;
      break;
    }
  }
  return { offset, messages };
}

/** Where the line starting at `offset` ends (after its newline), or `offset` while it is unfinished. */
async function skipLine(sessionPath: string, offset: number): Promise<number> {
  let position = offset;
  for await (const chunk of createReadStream(sessionPath, { start: offset }) as AsyncIterable<Buffer>) {
    const newline = chunk.indexOf(10);
    if (newline >= 0) return position + newline + 1;
    position += chunk.length;
  }
  return offset;
}

async function messageOf(line: string, directory: string): Promise<SentImagesMessage | null> {
  // Cheap tests first: most lines are the agent's own or tool results, often large.
  if (!line.includes('"type":"user"') || line.includes('"tool_result"')) return null;
  const parsed = userMessageOf(line);
  if (parsed === null) return null;
  const images: SentImage[] = [];
  for (const image of parsed.images) images.push({ path: await storeImage(directory, image.mimeType, image.data), mimeType: image.mimeType });
  return { text: parsed.text, images };
}

/** The agent's sent images, through its stored Claude session; none for other providers or a missing session. */
export async function sentImagesOf(paseo: PaseoApi, agentId: string): Promise<SentImagesMessage[]> {
  const refreshed = await paseo.agents
    .ref(agentId)
    .refresh()
    .catch(() => null);
  if (refreshed === null) return [];
  const agent = refreshed.agent;
  const persistence = agent.persistence;
  if (agent.provider !== "claude" || persistence === null || persistence === undefined || persistence.sessionId === "") return [];
  return readSentImages(claudeSessionPath(agent.cwd, persistence.sessionId));
}
