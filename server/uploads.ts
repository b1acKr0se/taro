/**
 * The composer's attachments, sent the way Paseo's composer sends them (TR-036): images as the
 * message's images, and each file written where Paseo's own upload store puts one,
 * `$PASEO_HOME/uploads/upload_<uuid>/<name>`, then named to the agent as an `uploaded_file`
 * attachment, which the daemon renders as the file's name, path, type and size.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { attachmentProblem, safeFileName, type OutgoingFile, type OutgoingImage } from "../shared/attachments";
import { paseoHome } from "./data-dir";
import type { SendExtras } from "./send";

export interface Attachments {
  images?: OutgoingImage[] | undefined;
  files?: OutgoingFile[] | undefined;
}

export function hasAttachments(attachments: Attachments): boolean {
  return (attachments.images?.length ?? 0) + (attachments.files?.length ?? 0) > 0;
}

/** Writes the files and returns what `send` takes; throws a sentence when they are too many or too large. */
export async function attachmentExtras(attachments: Attachments, home = paseoHome()): Promise<SendExtras> {
  const images = attachments.images ?? [];
  const files = attachments.files ?? [];
  const problem = attachmentProblem([...images, ...files]);
  if (problem !== null) throw new Error(problem);
  const uploaded = await Promise.all(
    files.map(async (file) => {
      const id = `upload_${randomUUID()}`;
      const fileName = safeFileName(file.fileName);
      const directory = join(home, "uploads", id);
      const path = join(directory, fileName);
      const bytes = Buffer.from(file.data, "base64");
      await mkdir(directory, { recursive: true });
      await writeFile(path, bytes);
      return { type: "uploaded_file" as const, id, fileName, mimeType: file.mimeType === "" ? "application/octet-stream" : file.mimeType, size: bytes.byteLength, path };
    }),
  );
  return {
    ...(images.length > 0 ? { images } : null),
    ...(uploaded.length > 0 ? { attachments: uploaded } : null),
  };
}
