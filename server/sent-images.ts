/**
 * Images the user sent an agent. Paseo's timeline keeps only a message's words, so for a Claude
 * agent they are read back from Claude's session file and copied, once per content, into the
 * plugin's images directory, where `taro.image.read` serves them.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { sentImagesDirectory } from "./data-dir";
import type { PaseoApi } from "./host-types";

/** A line longer than this is skipped; a message's images are capped by Paseo well under it. */
const MAX_LINE_CHARACTERS = 32 * 1024 * 1024;

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

/** A session line as the user's message with its images, or null when it is anything else. */
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
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  const images: ParsedMessage["images"] = [];
  content.forEach((block: unknown) => {
    if (typeof block !== "object" || block === null) return;
    const { type: kind, text, source } = block as { type?: unknown; text?: unknown; source?: unknown };
    if (kind === "text" && typeof text === "string") texts.push(text);
    if (kind !== "image" || typeof source !== "object" || source === null) return;
    const { type: sourceType, media_type: mediaType, data } = source as { type?: unknown; media_type?: unknown; data?: unknown };
    if (sourceType === "base64" && typeof mediaType === "string" && typeof data === "string" && EXTENSIONS[mediaType] !== undefined) {
      images.push({ mimeType: mediaType, data });
    }
  });
  if (images.length === 0) return null;
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

/** The user's messages with images in a Claude session file, in order; none when the file is missing. */
export async function readSentImages(sessionPath: string, directory = sentImagesDirectory()): Promise<SentImagesMessage[]> {
  if (!(await exists(sessionPath))) return [];
  const messages: SentImagesMessage[] = [];
  const lines = createInterface({ input: createReadStream(sessionPath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.length > MAX_LINE_CHARACTERS || !line.includes('"image"')) continue;
    const parsed = userMessageOf(line);
    if (parsed === null) continue;
    const images: SentImage[] = [];
    for (const image of parsed.images) images.push({ path: await storeImage(directory, image.mimeType, image.data), mimeType: image.mimeType });
    messages.push({ text: parsed.text, images });
  }
  return messages;
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
