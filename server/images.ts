/**
 * Serves an image file to the client, which cannot read the daemon's disk. Only from the
 * directories that hold images Taro shows — evidence, images the user sent, and Paseo's copies of
 * images an agent read — so a chat cannot be used to read any other file.
 */
import { readdir, realpath, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { evidenceDirectory, sentImagesDirectory } from "./data-dir";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface ImageRoots {
  /** Directories whose files may be served. */
  fixed: string[];
  /** Where Paseo writes `paseo-attachments-*` directories. */
  attachmentsParent: string;
}

export function defaultImageRoots(): ImageRoots {
  return { fixed: [evidenceDirectory(), sentImagesDirectory()], attachmentsParent: tmpdir() };
}

export function mimeTypeFor(path: string): string | null {
  return MIME_TYPES[extname(path).toLowerCase()] ?? null;
}

/** A `file://` URI (segments %-encoded) or an absolute path, as an absolute path; null for anything else. */
export function localPathOf(source: string): string | null {
  if (source.startsWith("file://")) {
    try {
      return fileURLToPath(source);
    } catch {
      return null;
    }
  }
  return isAbsolute(source) ? source : null;
}

function isInside(root: string, path: string): boolean {
  const between = relative(root, path);
  return between !== "" && !between.startsWith("..") && !isAbsolute(between);
}

async function realOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/** Every allowed root, resolved through symlinks, so a link inside one cannot lead out of it. */
async function allowedRoots(roots: ImageRoots): Promise<string[]> {
  const attachments = await readdir(roots.attachmentsParent, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("paseo-attachments-")).map((entry) => join(roots.attachmentsParent, entry.name)))
    .catch(() => [] as string[]);
  const resolved = await Promise.all([...roots.fixed, ...attachments].map((root) => realOrNull(root)));
  return resolved.filter((root): root is string => root !== null);
}

/** The image at `source`, base64, or null when it is not an image Taro may serve. */
export async function readImage(source: string, roots: ImageRoots = defaultImageRoots()): Promise<{ mimeType: string; data: string } | null> {
  const path = localPathOf(source);
  if (path === null) return null;
  const mimeType = mimeTypeFor(path);
  if (mimeType === null) return null;
  const real = await realOrNull(resolve(path));
  if (real === null || mimeTypeFor(real) === null) return null;
  const allowed = await allowedRoots(roots);
  if (!allowed.some((root) => isInside(root, real))) return null;
  try {
    const info = await stat(real);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return null;
    return { mimeType, data: (await readFile(real)).toString("base64") };
  } catch {
    return null;
  }
}
