/**
 * What the composer sends with a message (TR-036): images, which reach the agent as message images,
 * and files, which the daemon side writes where Paseo keeps its own uploads and names to the agent as
 * `uploaded_file` attachments — the two ways Paseo's composer sends them. Pure, for both sides.
 */
import { z } from "zod";

export const OutgoingImageSchema = z.object({ mimeType: z.string().min(1), data: z.string() });
export type OutgoingImage = z.infer<typeof OutgoingImageSchema>;

export const OutgoingFileSchema = z.object({ fileName: z.string().min(1), mimeType: z.string(), data: z.string() });
export type OutgoingFile = z.infer<typeof OutgoingFileSchema>;

/** The optional part of a `tell` request. */
export const OutgoingAttachmentsSchema = {
  images: z.array(OutgoingImageSchema).optional(),
  files: z.array(OutgoingFileSchema).optional(),
};

/** One attachment waiting in the composer, base64 without a `data:` prefix. */
export interface DraftAttachment {
  id: string;
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  data: string;
}

export const MAX_ATTACHMENTS = 10;
/** Every attachment of one message together, decoded; the request carries them as base64, a third more. */
export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;

/** The decoded size of base64 `data`. */
export function base64ByteLength(data: string): number {
  const length = data.replace(/[^A-Za-z0-9+/=]/g, "").length;
  if (length === 0) return 0;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((length * 3) / 4) - padding;
}

/** A sentence saying why these attachments cannot be sent together, or null when they can. */
export function attachmentProblem(attachments: readonly { data: string }[]): string | null {
  if (attachments.length > MAX_ATTACHMENTS) return `Attach at most ${MAX_ATTACHMENTS} files to one message.`;
  const bytes = attachments.reduce((total, attachment) => total + base64ByteLength(attachment.data), 0);
  if (bytes > MAX_ATTACHMENT_BYTES) return `Attachments over ${formatBytes(MAX_ATTACHMENT_BYTES)} cannot go in one message (these are ${formatBytes(bytes)}).`;
  return null;
}

/** The composer's attachments as the `tell` request carries them. */
export function outgoingAttachments(attachments: readonly DraftAttachment[]): { images: OutgoingImage[]; files: OutgoingFile[] } {
  return {
    images: attachments.filter((attachment) => attachment.kind === "image").map(({ mimeType, data }) => ({ mimeType, data })),
    files: attachments.filter((attachment) => attachment.kind === "file").map(({ fileName, mimeType, data }) => ({ fileName, mimeType, data })),
  };
}

/** A `data:` URL's type and base64 content (what a browser's FileReader and the phone's clipboard give), or null. */
export function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]*)(?:;[^;,]*)*;base64,([\s\S]*)$/.exec(url);
  if (match === null || match[2] === undefined) return null;
  return { mimeType: match[1] === undefined || match[1] === "" ? "application/octet-stream" : match[1], data: match[2] };
}

/** Most file systems cap one file name at 255 bytes of UTF-8. */
const MAX_FILE_NAME_BYTES = 255;

/** A character's size in UTF-8, by code point (counted by hand: `shared/` has no Buffer, and the phone's Hermes may lack TextEncoder). */
function utf8Bytes(character: string): number {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}

export function utf8Length(text: string): number {
  return Array.from(text).reduce((total, character) => total + utf8Bytes(character), 0);
}

/**
 * A file name safe as one path segment, by Paseo's own rule for its uploads: the client's name with
 * only what no file system allows replaced, and the extension kept when it is shortened.
 */
export function safeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f-\u009f:*?"<>|]/g, "_").trim();
  if (base === "" || base === "." || base === "..") return "upload";
  if (utf8Length(base) <= MAX_FILE_NAME_BYTES) return base;
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 && utf8Length(base.slice(dot)) < MAX_FILE_NAME_BYTES ? base.slice(dot) : "";
  // Whole characters only, so a cut never splits one.
  let budget = MAX_FILE_NAME_BYTES - utf8Length(extension);
  const stem = Array.from(base.slice(0, base.length - extension.length)).filter((character) => {
    budget -= utf8Bytes(character);
    return budget >= 0;
  });
  return stem.join("") + extension;
}

/** A file name for an image that came without one (a pasted image). */
export function imageFileName(mimeType: string, index: number): string {
  const extension = mimeType.startsWith("image/") ? mimeType.slice("image/".length).replace("jpeg", "jpg").replace(/\W.*$/, "") : "bin";
  return `image-${index + 1}.${extension === "" ? "png" : extension}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
