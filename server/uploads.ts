/**
 * The composer's attachments, sent the way Paseo's composer sends them (TR-036): images as the
 * message's images, and each file written where Paseo's own upload store puts one,
 * `$PASEO_HOME/uploads/upload_<uuid>/<name>`, then named to the agent as an `uploaded_file`
 * attachment, which the daemon renders as the file's name, path, type and size.
 */
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { attachmentProblem, safeFileName, type OutgoingFile, type OutgoingImage } from "../shared/attachments";
import { paseoHome } from "./data-dir";
import type { PaseoApi } from "./host-types";
import { sendChatMessageOnce, sendInterrupting, sendWithoutInterrupting } from "./send";

/** What the composer sends with the words: attachments, and the chat's own id for the message (TR-084). */
export interface Attachments {
  images?: OutgoingImage[] | undefined;
  files?: OutgoingFile[] | undefined;
  /** Lets the chat find the message in the timeline and mark it until the agent takes it up. */
  messageId?: string | undefined;
  /** Whether the agent was mid-turn as the message came: one sent during its compaction is handed back (TR-102). */
  agentMidTurn?: boolean | undefined;
  /** Send now (TR-171): cut the running turn off rather than join it. */
  interrupt?: boolean | undefined;
}

export function hasAttachments(attachments: Attachments): boolean {
  return (attachments.images?.length ?? 0) + (attachments.files?.length ?? 0) > 0;
}

/**
 * The user's words and attachments to an agent, joining a running turn where possible (or, for Send
 * now, cutting it off). Throws a sentence when the attachments are too many or too large, before
 * writing anything; a write or the send failing removes every file this call wrote, so a retry
 * leaves no orphan copy behind.
 */
export async function sendWithAttachments(paseo: PaseoApi, agentId: string, words: string, attachments: Attachments, home = paseoHome()): Promise<void> {
  // A chat message sent again under its own id (a retry, a reconnect) goes once (TR-102).
  await sendChatMessageOnce(paseo, agentId, attachments.messageId, () => sendWithUploads(paseo, agentId, words, attachments, home), attachments.agentMidTurn === true);
}

async function sendWithUploads(paseo: PaseoApi, agentId: string, words: string, attachments: Attachments, home: string): Promise<void> {
  const images = attachments.images ?? [];
  const files = attachments.files ?? [];
  const problem = attachmentProblem([...images.map((image) => ({ ...image, kind: "image" as const })), ...files]);
  if (problem !== null) throw new Error(problem);
  const ids = files.map(() => `upload_${randomUUID()}`);
  const directories = ids.map((id) => join(home, "uploads", id));
  const writes = await Promise.allSettled(
    files.map(async (file, index) => {
      const id = ids[index] ?? "";
      const directory = directories[index] ?? "";
      const fileName = safeFileName(file.fileName);
      const path = join(directory, fileName);
      const bytes = Buffer.from(file.data, "base64");
      await mkdir(directory, { recursive: true });
      await writeFile(path, bytes);
      return { type: "uploaded_file" as const, id, fileName, mimeType: file.mimeType === "" ? "application/octet-stream" : file.mimeType, size: bytes.byteLength, path };
    }),
  );
  // Every write has settled, so nothing lands after the cleanup.
  const removeAll = () => Promise.allSettled(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  const failed = writes.find((write) => write.status === "rejected");
  if (failed !== undefined) {
    await removeAll();
    throw failed.reason;
  }
  const uploaded = writes.flatMap((write) => (write.status === "fulfilled" ? [write.value] : []));
  try {
    const send = attachments.interrupt === true ? sendInterrupting : sendWithoutInterrupting;
    await send(paseo, agentId, words, {
      ...(images.length > 0 ? { images } : null),
      ...(uploaded.length > 0 ? { attachments: uploaded } : null),
      ...(attachments.messageId === undefined ? null : { messageId: attachments.messageId }),
    });
  } catch (error) {
    await removeAll();
    throw error;
  }
}
