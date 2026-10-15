import { describe, expect, it } from "vitest";

import { droppedImageType, watchFileDrops, type WebDragEvent } from "./file-drop";

type Listener = (event: WebDragEvent) => void;

/** A stand-in for a DOM element: keeps its listeners and fires them by type. */
function fakeElement() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener: (type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
    fire(type: string, event: WebDragEvent) {
      listeners.get(type)?.forEach((listener) => listener(event));
    },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

function dragEvent(types: string[], files: unknown[] = []) {
  const event = {
    dataTransfer: { types, files, dropEffect: "none" },
    prevented: false,
    stopped: false,
    preventDefault() {
      event.prevented = true;
    },
    stopPropagation() {
      event.stopped = true;
    },
  };
  return event;
}

const png = { name: "screenshot.png", type: "image/png" };
const pdf = { name: "report.pdf", type: "application/pdf" };

function watched(options: { disabled?: () => boolean } = {}) {
  const element = fakeElement();
  const dragging: boolean[] = [];
  const drops: unknown[][] = [];
  const stop = watchFileDrops(element, { onDragging: (value) => dragging.push(value), onDrop: (files) => drops.push(files), disabled: options.disabled ?? (() => false) });
  return { element, dragging, drops, stop };
}

describe("watchFileDrops", () => {
  it("shows the target while files are dragged over and hands over a dropped image", () => {
    const { element, dragging, drops } = watched();
    const enter = dragEvent(["Files"], [png]);
    element.fire("dragenter", enter);
    const over = dragEvent(["Files"], [png]);
    element.fire("dragover", over);
    expect(dragging).toEqual([true]);
    expect(over.prevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    const drop = dragEvent(["Files"], [png]);
    element.fire("drop", drop);
    expect(drop.prevented).toBe(true);
    expect(dragging).toEqual([true, false]);
    expect(drops).toEqual([[png]]);
  });

  it("hands over several files of mixed kinds in one drop, in their order", () => {
    const { element, drops } = watched();
    element.fire("dragenter", dragEvent(["Files"]));
    element.fire("drop", dragEvent(["Files"], [png, pdf, { name: "notes.txt", type: "text/plain" }]));
    expect(drops).toEqual([[png, pdf, { name: "notes.txt", type: "text/plain" }]]);
  });

  it("ignores a drag that carries no files, such as selected text, and leaves it to the browser", () => {
    const { element, dragging, drops } = watched();
    const enter = dragEvent(["text/plain"]);
    element.fire("dragenter", enter);
    const over = dragEvent(["text/plain"]);
    element.fire("dragover", over);
    const drop = dragEvent(["text/plain", "text/html"]);
    element.fire("drop", drop);
    expect(dragging).toEqual([]);
    expect(drops).toEqual([]);
    expect([enter.prevented, over.prevented, drop.prevented]).toEqual([false, false, false]);
  });

  it("keeps the target up while the drag moves over the pane's children, and drops it on leaving the pane", () => {
    const { element, dragging } = watched();
    element.fire("dragenter", dragEvent(["Files"])); // the pane
    element.fire("dragenter", dragEvent(["Files"])); // a message inside it
    element.fire("dragleave", dragEvent(["Files"])); // out of the pane, into the message
    expect(dragging).toEqual([true]);
    element.fire("dragleave", dragEvent(["Files"])); // out of the message and the pane
    expect(dragging).toEqual([true, false]);
    element.fire("dragleave", dragEvent(["Files"])); // a stray leave does not go below zero
    element.fire("dragenter", dragEvent(["Files"]));
    expect(dragging).toEqual([true, false, true]);
  });

  it("does nothing for files dragged and dropped outside the pane", () => {
    const { dragging, drops } = watched();
    // Events on another element never reach this one's listeners.
    const elsewhere = fakeElement();
    elsewhere.fire("dragenter", dragEvent(["Files"], [png]));
    elsewhere.fire("drop", dragEvent(["Files"], [png]));
    expect(dragging).toEqual([]);
    expect(drops).toEqual([]);
  });

  it("shows no target and takes no drop while a send runs, and the browser is told it cannot drop", () => {
    let sending = true;
    const { element, dragging, drops } = watched({ disabled: () => sending });
    element.fire("dragenter", dragEvent(["Files"], [png]));
    const over = dragEvent(["Files"], [png]);
    element.fire("dragover", over);
    expect(over.dataTransfer.dropEffect).toBe("none");
    element.fire("drop", dragEvent(["Files"], [png]));
    expect(dragging).toEqual([]);
    expect(drops).toEqual([]);
    sending = false;
    element.fire("dragenter", dragEvent(["Files"], [png]));
    element.fire("drop", dragEvent(["Files"], [png]));
    expect(drops).toEqual([[png]]);
  });

  it("takes no empty drop", () => {
    const { element, drops } = watched();
    element.fire("dragenter", dragEvent(["Files"]));
    element.fire("drop", dragEvent(["Files"], []));
    expect(drops).toEqual([]);
  });

  it("stops listening when stopped, putting away a target that was up", () => {
    const { element, dragging, drops, stop } = watched();
    element.fire("dragenter", dragEvent(["Files"]));
    stop();
    expect(dragging).toEqual([true, false]);
    expect(element.count()).toBe(0);
    element.fire("drop", dragEvent(["Files"], [png]));
    expect(drops).toEqual([]);
  });

  it("does nothing for a node that is not a DOM element (a phone's view, none yet)", () => {
    const handlers = { onDragging: () => undefined, onDrop: () => undefined, disabled: () => false };
    expect(() => watchFileDrops(null, handlers)()).not.toThrow();
    expect(() => watchFileDrops({}, handlers)()).not.toThrow();
  });
});

describe("droppedImageType", () => {
  it("takes the raster images Paseo takes as images", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/heic", "image/heif", "image/avif", "image/tiff"]) {
      expect(droppedImageType({ name: "x", type })).toBe(type);
    }
    expect(droppedImageType({ name: "x.jpg", type: "image/jpg" })).toBe("image/jpeg");
    expect(droppedImageType({ name: "x.png", type: "IMAGE/PNG; charset=binary" })).toBe("image/png");
  });

  it("treats an SVG, a PDF, text and an unknown type as files", () => {
    expect(droppedImageType({ name: "logo.svg", type: "image/svg+xml" })).toBeNull();
    expect(droppedImageType(pdf)).toBeNull();
    expect(droppedImageType({ name: "notes.txt", type: "text/plain" })).toBeNull();
    // A browser's type wins over the extension.
    expect(droppedImageType({ name: "photo.png", type: "application/octet-stream" })).toBeNull();
  });

  it("judges a file the system gave no type by its extension", () => {
    expect(droppedImageType({ name: "IMG_0042.HEIC", type: "" })).toBe("image/heic");
    expect(droppedImageType({ name: "scan.TIF" })).toBe("image/tiff");
    expect(droppedImageType({ name: "archive.tar.gz", type: "" })).toBeNull();
    expect(droppedImageType({ name: "Makefile", type: "" })).toBeNull();
    expect(droppedImageType({})).toBeNull();
  });
});
