/**
 * Files dragged onto a chat pane in a browser or the desktop app (TR-099), handled as Paseo's own
 * agent pane does (`use-drop-listeners.ts` in its app): element-scoped HTML5 drag events, a counter
 * so dragging over the pane's children does not flicker the target, and only drags that carry files.
 * Paseo's desktop shell stops Electron opening a file dropped on its window and leaves the drop to
 * these same events. Pure, apart from the element it is given.
 */

/** The part of a browser's drag event this reads. */
export interface WebDragEvent {
  dataTransfer: { types: ArrayLike<string>; files: ArrayLike<unknown>; dropEffect: string } | null;
  preventDefault(): void;
  stopPropagation(): void;
}

interface DropNode {
  addEventListener(type: string, listener: (event: WebDragEvent) => void): void;
  removeEventListener(type: string, listener: (event: WebDragEvent) => void): void;
}

export interface FileDropHandlers {
  /** Whether files are being dragged over the pane, to show the drop target. */
  onDragging: (dragging: boolean) => void;
  /** The files of a drop, in the order they were dragged; never called with none. */
  onDrop: (files: unknown[]) => void;
  /** Read at each event: while it says so, the pane shows no target and takes no drop (a send under way). */
  disabled: () => boolean;
}

function carriesFiles(event: WebDragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Listens for file drops on `node` until the returned stop is called; does nothing for a node that is not a DOM element. */
export function watchFileDrops(node: unknown, handlers: FileDropHandlers): () => void {
  const element = node as Partial<DropNode> | null;
  if (element === null || typeof element.addEventListener !== "function" || typeof element.removeEventListener !== "function") return () => undefined;
  const target = element as DropNode;
  // Entering a child fires its dragenter before the parent's dragleave; counting keeps the target up.
  let depth = 0;
  let dragging = false;
  const show = (next: boolean) => {
    if (next === dragging) return;
    dragging = next;
    handlers.onDragging(next);
  };
  const enter = (event: WebDragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
    show(!handlers.disabled());
  };
  const over = (event: WebDragEvent) => {
    if (!carriesFiles(event) || event.dataTransfer === null) return;
    // Without this the browser takes no drop here (and a browser tab would open the file instead).
    event.preventDefault();
    const accepts = !handlers.disabled();
    event.dataTransfer.dropEffect = accepts ? "copy" : "none";
    show(accepts);
  };
  const leave = (event: WebDragEvent) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) show(false);
  };
  const drop = (event: WebDragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    depth = 0;
    show(false);
    if (handlers.disabled()) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) handlers.onDrop(files);
  };
  target.addEventListener("dragenter", enter);
  target.addEventListener("dragover", over);
  target.addEventListener("dragleave", leave);
  target.addEventListener("drop", drop);
  return () => {
    target.removeEventListener("dragenter", enter);
    target.removeEventListener("dragover", over);
    target.removeEventListener("dragleave", leave);
    target.removeEventListener("drop", drop);
    show(false);
  };
}

// The raster images Paseo's composer takes as images (`attachments/file-types.ts` in its app); an
// SVG, a PDF or anything else is attached as a file.
const IMAGE_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};
const IMAGE_TYPES = new Set(Object.values(IMAGE_TYPE_BY_EXTENSION));

/**
 * The image type a dropped file is attached as, or null for a file that is no raster image. The
 * browser's own type wins; a file without one (some systems give none) is judged by its extension.
 */
export function droppedImageType(file: { type?: unknown; name?: unknown }): string | null {
  const given = typeof file.type === "string" ? file.type.split(";", 1)[0]!.trim().toLowerCase() : "";
  if (given !== "") {
    const type = given === "image/jpg" ? "image/jpeg" : given;
    return IMAGE_TYPES.has(type) ? type : null;
  }
  const name = typeof file.name === "string" ? file.name.toLowerCase() : "";
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : (IMAGE_TYPE_BY_EXTENSION[name.slice(dot)] ?? null);
}
