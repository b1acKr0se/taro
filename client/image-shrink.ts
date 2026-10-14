/**
 * Making an image small enough for the agent before it is attached (TR-037): an image over
 * `MAX_IMAGE_BASE64_LENGTH` fails the agent's turn, and a phone camera's photos routinely are. It is
 * scaled down and saved as JPEG, step by step, until it fits: through a canvas on the web, through
 * the `ExpoImageManipulator` module Paseo's app ships on the phone, looked up when used like the
 * pickers' modules (`attachment-sources.ts`). One that cannot be made to fit is returned unchanged,
 * and the composer refuses it.
 */
import { imageTooLarge, parseDataUrl, type DraftAttachment } from "../shared/attachments";
import { expoModule } from "./attachment-sources";

type Loose = Record<string, unknown>;

/** Longest edge and JPEG quality, tried in order; 1568 px is the edge Claude scales larger images down to anyway. */
export const SHRINK_STEPS: readonly { maxEdge: number; quality: number }[] = [
  { maxEdge: 2048, quality: 0.85 },
  { maxEdge: 1568, quality: 0.8 },
  { maxEdge: 1568, quality: 0.6 },
  { maxEdge: 1024, quality: 0.6 },
  { maxEdge: 768, quality: 0.5 },
];

/** Re-encodes one image as JPEG with its longest edge at most `maxEdge`. */
export type ImageEncoder = (maxEdge: number, quality: number) => Promise<{ mimeType: string; data: string }>;

/** `width` × `height` with its longest edge at most `maxEdge`, never enlarged, in whole pixels of at least 1. */
export function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The name with its extension made `.jpg`, as the shrunk image is. */
export function jpegFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.jpg`;
}

/** The image itself when it fits; else the first step's result that fits; else the image unchanged. */
export async function shrinkImage(image: DraftAttachment, encode: ImageEncoder): Promise<DraftAttachment> {
  if (image.kind !== "image" || !imageTooLarge(image)) return image;
  try {
    for (const step of SHRINK_STEPS) {
      const encoded = await encode(step.maxEdge, step.quality);
      if (!imageTooLarge(encoded)) return { ...image, fileName: jpegFileName(image.fileName), mimeType: encoded.mimeType, data: encoded.data };
    }
  } catch {
    // The image cannot be decoded or encoded here: it stays as it is, and the composer refuses it.
  }
  return image;
}

// ---------------------------------------------------------------- web

function loadWebImage(root: Loose, url: string): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    const ImageElement = root.Image as new () => Loose & { naturalWidth: number; naturalHeight: number };
    const element = new ImageElement();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("The browser cannot read that image."));
    element.src = url;
  });
}

/** Draws the image on a canvas at each step's size; JPEG has no transparency, so it is drawn on white. */
export function webEncoder(root: object, image: DraftAttachment): ImageEncoder {
  const global = root as Loose;
  let loaded: Promise<{ naturalWidth: number; naturalHeight: number }> | null = null;
  return async (maxEdge, quality) => {
    if (loaded === null) loaded = loadWebImage(global, `data:${image.mimeType};base64,${image.data}`);
    const element = await loaded;
    const size = scaledSize(element.naturalWidth, element.naturalHeight, maxEdge);
    const document = global.document as { createElement(tag: string): Loose & { getContext(kind: string): Loose | null; toDataURL(type: string, quality: number): string } };
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d") as { fillStyle: string; fillRect(...args: number[]): void; drawImage(...args: unknown[]): void } | null;
    if (context === null) throw new Error("The browser cannot draw images.");
    context.fillStyle = "white";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(element, 0, 0, size.width, size.height);
    const parsed = parseDataUrl(canvas.toDataURL("image/jpeg", quality));
    if (parsed === null) throw new Error("The browser cannot encode images.");
    return parsed;
  };
}

// ---------------------------------------------------------------- phone

type Releasable = Loose & { release?: () => void };
type ManipulatorContext = Releasable & { resize(size: { width?: number; height?: number }): unknown; renderAsync(): Promise<ImageRef> };
type ImageRef = Releasable & { width: number; height: number; saveAsync(options: Loose): Promise<Loose> };

function release(object: Releasable | null): void {
  if (typeof object?.release === "function") object.release();
}

/**
 * Renders the image at each step's size with expo-image-manipulator 14's native module
 * (`manipulate(uri)` → context, `resize`, `renderAsync()` → image, `saveAsync`), or null when the
 * app has no such module. `uri` is the picked file's or a `data:` URL.
 */
export function phoneEncoder(root: object, uri: string): ImageEncoder | null {
  const manipulator = expoModule(root, "imageManipulator");
  if (manipulator === null) return null;
  const open = () => manipulator.manipulate?.(uri) as ManipulatorContext;
  let original: Promise<{ width: number; height: number }> | null = null;
  return async (maxEdge, quality) => {
    if (original === null) original = (async () => {
      const context = open();
      const rendered = await context.renderAsync();
      const size = { width: rendered.width, height: rendered.height };
      release(rendered);
      release(context);
      return size;
    })();
    const full = await original;
    const size = scaledSize(full.width, full.height, maxEdge);
    const context = open();
    let rendered: ImageRef | null = null;
    try {
      context.resize(size);
      rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: "jpeg", compress: quality, base64: true });
      if (typeof saved.base64 !== "string" || saved.base64 === "") throw new Error("The image could not be encoded.");
      return { mimeType: "image/jpeg", data: saved.base64 };
    } finally {
      release(rendered);
      release(context);
    }
  };
}

/** The image made small enough on this client where it can be; `uri` is where the phone can read it from. */
export async function fitImage(root: object, platform: string, image: DraftAttachment, uri?: string): Promise<DraftAttachment> {
  if (image.kind !== "image" || !imageTooLarge(image)) return image;
  const encoder = platform === "web" ? webEncoder(root, image) : phoneEncoder(root, uri ?? `data:${image.mimeType};base64,${image.data}`);
  return encoder === null ? image : shrinkImage(image, encoder);
}
