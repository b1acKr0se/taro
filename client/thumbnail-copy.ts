/**
 * Small copies of chat images for their thumbnails on the phone (TR-164). React Native's Android
 * image pipeline decodes a `data:` image at its full size whatever the box it is drawn in: thirty
 * screenshots in a chat held about 54 million pixels for the 8 million on screen, and scrolling past
 * them stuttered. Each image is rendered once, at the thumbnail's device pixels, by the
 * `ExpoImageManipulator` module Paseo's app ships (as `image-shrink.ts` uses it), saved to the app's
 * cache, and the thumbnail draws that file; the full image is still what the viewer opens.
 * Copies are made one at a time, the newest asked for first, kept for the app's lifetime across the bundle's re-evaluations
 * (`kept.ts`), and a failed copy is remembered as null so the thumbnail draws the full image.
 */
import { expoModule } from "./attachment-sources";
import { keptMap, keptObject } from "./kept";
import { thumbnailCopySize, type FrameSize } from "./thumbnail-size";

type Loose = Record<string, unknown>;
type Releasable = Loose & { release?: () => void };
type ManipulatorContext = Releasable & { resize(size: { width?: number; height?: number }): unknown; renderAsync(): Promise<ImageRef> };
type ImageRef = Releasable & { width?: unknown; height?: unknown; saveAsync(options: Loose): Promise<Loose> };

/** Copies kept at most, oldest dropped first; each is one file URI, the file itself in the app's cache. */
export const MAX_KEPT_COPIES = 400;

/** A copy's URI, null when it could not be made, undefined while it is being made. */
export type CopyState = string | null | undefined;

function release(object: Releasable | null): void {
  if (typeof object?.release === "function") object.release();
}

export function copyKey(source: string, size: FrameSize): string {
  return `${size.width}x${size.height} ${source}`;
}

/** Whether this app can make copies: the phone, with the module there. */
export function canCopyThumbnails(root: object, platform: string): boolean {
  return platform !== "web" && expoModule(root, "imageManipulator") !== null;
}

/**
 * The size of the copy a thumbnail of `frame` should draw, or null to draw `uri` itself: only for an
 * image the daemon sent (a `data:` URL) whose size is known, where copies can be made, and larger
 * than the thumbnail's device pixels. Never for a GIF, whose copy would stand still.
 */
export function copySizeFor(uri: string | null | undefined, size: FrameSize | null, frame: FrameSize, canCopy: boolean, pixelRatio: number): FrameSize | null {
  if (!canCopy || typeof uri !== "string" || !uri.startsWith("data:") || uri.startsWith("data:image/gif") || size === null) return null;
  return thumbnailCopySize(size, frame, pixelRatio);
}

/**
 * What the thumbnail draws: `uri` itself when it needs no copy; else the copy once made, `uri` when
 * the copy failed, and undefined (an empty frame) while it is made, as drawing the full image
 * meanwhile would decode it whole after all.
 */
export function drawnUri(uri: string | null | undefined, needsCopy: boolean, copy: CopyState): string | null | undefined {
  if (!needsCopy) return uri;
  if (copy === undefined) return undefined;
  return copy ?? uri;
}

/** A copy not made by then is given up for the full image, so one stuck render cannot hold up every thumbnail after it. */
export const COPY_TIMEOUT_MS = 15_000;

function withinTime(made: Promise<string | null>): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), COPY_TIMEOUT_MS);
    void made.then((copy) => {
      clearTimeout(timer);
      resolve(copy);
    });
  });
}

/** Rendered shapes this far apart are not the same picture's: the copy came out turned. */
const SHAPE_TOLERANCE = 0.02;

/**
 * Renders `uri` at `size` and saves it, PNG for an image that may be transparent, else JPEG; the saved
 * file's URI. Resized by width alone, so the image keeps the shape the module loaded it in; a JPEG the
 * module did not turn as its EXIF orientation says (the daemon's size is turned) comes out in the
 * other shape, and is dropped for the full image rather than drawn sideways.
 */
async function renderCopy(root: object, uri: string, mimeType: string, size: FrameSize): Promise<string | null> {
  const manipulator = expoModule(root, "imageManipulator");
  if (manipulator === null) return null;
  let context: ManipulatorContext | null = null;
  let rendered: ImageRef | null = null;
  try {
    context = manipulator.manipulate?.(uri) as ManipulatorContext;
    context.resize({ width: size.width });
    rendered = await context.renderAsync();
    if (!sameShape(rendered, size)) return null;
    const saved = await rendered.saveAsync(mimeType === "image/jpeg" ? { format: "jpeg", compress: 0.9 } : { format: "png" });
    return typeof saved.uri === "string" && saved.uri !== "" ? saved.uri : null;
  } catch {
    return null;
  } finally {
    release(rendered);
    release(context);
  }
}

function sameShape(rendered: ImageRef, size: FrameSize): boolean {
  const { width, height } = rendered;
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) return false;
  return Math.abs(width / height / (size.width / size.height) - 1) <= SHAPE_TOLERANCE;
}

interface CopyJob {
  key: string;
  make: () => Promise<void>;
}

interface CopyStore {
  /** Settled copies, so a thumbnail mounted again draws its copy in its first frame. */
  done: Map<string, string | null>;
  /** Copies asked for, each awaited by every thumbnail of that key. */
  running: Map<string, Promise<string | null>>;
  /** Copies waiting, the newest made first; one is made at a time. */
  work: { waiting: CopyJob[]; busy: boolean };
}

function storeOf(root: object): CopyStore {
  return {
    done: keptMap<string, string | null>(root, "thumbnailCopies.v1"),
    running: keptMap<string, Promise<string | null>>(root, "thumbnailCopiesRunning.v2"),
    work: keptObject<{ waiting: CopyJob[]; busy: boolean }>(root, "thumbnailCopyWork.v2", { waiting: [], busy: false }),
  };
}

/** Makes the newest waiting copy, then the next newest, until none waits. */
function work(store: CopyStore): void {
  if (store.work.busy) return;
  const job = store.work.waiting.pop();
  if (job === undefined) return;
  store.work.busy = true;
  void job.make().finally(() => {
    store.work.busy = false;
    work(store);
  });
}

/** The copy of `source` at `size` if it is settled: its URI, null when it failed, undefined when not made yet. */
export function settledCopy(root: object, source: string, size: FrameSize): CopyState {
  const key = copyKey(source, size);
  const done = storeOf(root).done;
  return done.has(key) ? done.get(key) : undefined;
}

/**
 * The copy of `source` (drawn from `uri`, a `data:` URL) at `size`, made once. The newest asked for is
 * made first: a chat mounts every message, oldest first, and opens at its end, so the images on
 * screen are the last asked for.
 */
export function thumbnailCopy(root: object, source: string, uri: string, mimeType: string, size: FrameSize): Promise<string | null> {
  const key = copyKey(source, size);
  const store = storeOf(root);
  if (store.done.has(key)) return Promise.resolve(store.done.get(key) ?? null);
  const running = store.running.get(key);
  if (running !== undefined) return running;
  const made = new Promise<string | null>((resolve) => {
    store.work.waiting.push({
      key,
      make: () =>
        withinTime(renderCopy(root, uri, mimeType, size)).then((copy) => {
          store.running.delete(key);
          store.done.set(key, copy);
          // Oldest first: a Map keeps insertion order.
          while (store.done.size > MAX_KEPT_COPIES) {
            const oldest = store.done.keys().next();
            if (oldest.done === true) break;
            store.done.delete(oldest.value);
          }
          resolve(copy);
        }),
    });
  });
  store.running.set(key, made);
  work(store);
  return made;
}
