import { describe, expect, it } from "vitest";

import { MAX_IMAGE_BASE64_LENGTH } from "../shared/attachments";
import { droppedFilesAsAttachments, imagesFromPaste, pickAttachments } from "./attachment-pickers";

/** A stand-in for the `FileReader` of a browser or React Native: a "blob" here is `{ type, content }`. */
function FakeReader(this: { result: unknown; onload: (() => void) | null; onerror: (() => void) | null; readAsDataURL(blob: unknown): void }) {
  this.result = null;
  this.onload = null;
  this.onerror = null;
  this.readAsDataURL = (blob: unknown) => {
    const { type, content } = blob as { type: string; content: string };
    this.result = `data:${type};base64,${Buffer.from(content).toString("base64")}`;
    queueMicrotask(() => this.onload?.());
  };
}

const b64 = (text: string) => Buffer.from(text).toString("base64");

function phone(modules: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { expo: { modules }, FileReader: FakeReader, ...extra };
}

describe("pickAttachments on the phone app", () => {
  it("returns picked images with their base64, type and name", async () => {
    const asked: unknown[] = [];
    const root = phone({
      ExponentImagePicker: {
        requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
        launchImageLibraryAsync: async (options: unknown) => {
          asked.push(options);
          return { canceled: false, assets: [{ uri: "file:///a.jpg", base64: b64("jpg"), mimeType: "image/jpeg", fileName: "IMG_1.jpg" }, { uri: "file:///b", base64: b64("png"), mimeType: "image/png" }] };
        },
      },
    });
    const picked = await pickAttachments(root, "ios", "image");
    expect(picked.map(({ kind, fileName, mimeType, data }) => ({ kind, fileName, mimeType, data }))).toEqual([
      { kind: "image", fileName: "IMG_1.jpg", mimeType: "image/jpeg", data: b64("jpg") },
      { kind: "image", fileName: "image-2.png", mimeType: "image/png", data: b64("png") },
    ]);
    expect(new Set(picked.map((item) => item.id)).size).toBe(2);
    expect(asked).toEqual([{ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.8, base64: true }]);
  });

  it("shrinks a picked photo over the agent's limit from its file, leaving smaller ones alone (TR-037)", async () => {
    const shrunkFrom: string[] = [];
    const root = phone({
      ExponentImagePicker: {
        launchImageLibraryAsync: async () => ({
          canceled: false,
          assets: [
            { uri: "file:///big.heic", base64: "A".repeat(MAX_IMAGE_BASE64_LENGTH + 4), mimeType: "image/heic", fileName: "IMG_2.HEIC" },
            { uri: "file:///small.jpg", base64: b64("small"), mimeType: "image/jpeg", fileName: "IMG_3.jpg" },
          ],
        }),
      },
      ExpoImageManipulator: {
        manipulate: (uri: string) => {
          shrunkFrom.push(uri);
          return {
            resize: () => undefined,
            renderAsync: async () => ({ width: 4032, height: 3024, saveAsync: async () => ({ base64: b64("shrunk") }) }),
          };
        },
      },
    });
    const picked = await pickAttachments(root, "ios", "image");
    expect(picked.map(({ fileName, mimeType, data }) => ({ fileName, mimeType, data }))).toEqual([
      { fileName: "IMG_2.jpg", mimeType: "image/jpeg", data: b64("shrunk") },
      { fileName: "IMG_3.jpg", mimeType: "image/jpeg", data: b64("small") },
    ]);
    expect(new Set(shrunkFrom)).toEqual(new Set(["file:///big.heic"]));
  });

  it("reads an image from its file when the picker gave no base64", async () => {
    const root = phone({
      ExponentImagePicker: { launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: "file:///c.jpg" }] }) },
      ExponentFileSystem: { readAsStringAsync: async (uri: string, options: unknown) => (uri === "file:///c.jpg" && JSON.stringify(options) === '{"encoding":"base64"}' ? b64("from disk") : "") },
    });
    const [image] = await pickAttachments(root, "android", "image");
    expect(image).toMatchObject({ mimeType: "image/jpeg", data: b64("from disk") });
  });

  it("returns nothing when the user cancels", async () => {
    const root = phone({ ExponentImagePicker: { launchImageLibraryAsync: async () => ({ canceled: true, assets: null }) } });
    expect(await pickAttachments(root, "ios", "image")).toEqual([]);
  });

  it("says so when the photo library is not allowed", async () => {
    const root = phone({ ExponentImagePicker: { requestMediaLibraryPermissionsAsync: async () => ({ granted: false }), launchImageLibraryAsync: async () => ({ canceled: true }) } });
    await expect(pickAttachments(root, "ios", "image")).rejects.toThrow(/Allow Paseo to read your photos/);
  });

  it("pastes the clipboard's image as a PNG", async () => {
    const root = phone({ ExpoClipboard: { getImageAsync: async (options: unknown) => (JSON.stringify(options) === '{"format":"png","jpegQuality":1}' ? { data: `data:image/png;base64,${b64("pasted")}` } : null) } });
    const [image] = await pickAttachments(root, "android", "paste");
    expect(image).toMatchObject({ kind: "image", fileName: "image-1.png", mimeType: "image/png", data: b64("pasted") });
  });

  it("says so when the clipboard holds no image", async () => {
    const root = phone({ ExpoClipboard: { getImageAsync: async () => null } });
    await expect(pickAttachments(root, "ios", "paste")).rejects.toThrow(/no image on the clipboard/);
  });

  it("uploads picked documents, read through fetch when there is no file system module", async () => {
    const fetched: string[] = [];
    const root = phone(
      { ExpoDocumentPicker: { getDocumentAsync: async () => ({ canceled: false, assets: [{ uri: "file:///cache/report.pdf", name: "report.pdf", mimeType: "application/pdf", size: 3 }, { uri: "file:///cache/x" }] }) } },
      {
        fetch(this: unknown, uri: string) {
          fetched.push(uri);
          return Promise.resolve({ blob: async () => ({ type: "application/pdf", content: `content of ${uri}` }) });
        },
      },
    );
    const files = await pickAttachments(root, "android", "file");
    expect(files.map(({ kind, fileName, mimeType, data }) => ({ kind, fileName, mimeType, data }))).toEqual([
      { kind: "file", fileName: "report.pdf", mimeType: "application/pdf", data: b64("content of file:///cache/report.pdf") },
      { kind: "file", fileName: "file", mimeType: "application/octet-stream", data: b64("content of file:///cache/x") },
    ]);
    expect(fetched).toEqual(["file:///cache/report.pdf", "file:///cache/x"]);
  });

  it("rejects with a sentence when the module went missing after the sheet opened", async () => {
    await expect(pickAttachments(phone({}), "ios", "image")).rejects.toThrow(/cannot pick images/);
    await expect(pickAttachments(phone({}), "ios", "paste")).rejects.toThrow(/cannot read images/);
    await expect(pickAttachments(phone({}), "ios", "file")).rejects.toThrow(/cannot pick files/);
  });
});

describe("pickAttachments on the web", () => {
  it("pastes the first image type of each clipboard item", async () => {
    const root = {
      FileReader: FakeReader,
      navigator: {
        clipboard: {
          read: async () => [
            { types: ["text/plain"], getType: async () => ({ type: "text/plain", content: "words" }) },
            { types: ["image/png", "image/jpeg"], getType: async (type: string) => ({ type, content: `bytes as ${type}` }) },
          ],
        },
      },
    };
    const images = await pickAttachments(root, "web", "paste");
    expect(images.map(({ mimeType, data }) => ({ mimeType, data }))).toEqual([{ mimeType: "image/png", data: b64("bytes as image/png") }]);
  });

  it("says so when the clipboard has no image or may not be read", async () => {
    const empty = { FileReader: FakeReader, navigator: { clipboard: { read: async () => [{ types: ["text/plain"], getType: async () => null }] } } };
    await expect(pickAttachments(empty, "web", "paste")).rejects.toThrow(/no image/);
    const refused = { FileReader: FakeReader, navigator: { clipboard: { read: async () => Promise.reject(new Error("NotAllowedError")) } } };
    await expect(pickAttachments(refused, "web", "paste")).rejects.toThrow(/did not let Taro read the clipboard/);
  });

  it("opens a file chooser limited to images for Add image, and reads what is chosen", async () => {
    const inputs: Record<string, unknown>[] = [];
    const root = {
      FileReader: FakeReader,
      document: {
        createElement() {
          const listeners: Record<string, () => void> = {};
          const input: Record<string, unknown> = {
            addEventListener: (type: string, listener: () => void) => (listeners[type] = listener),
            click: () => {
              input.files = [{ name: "shot.png", type: "image/png", content: "png!" }];
              listeners.change?.();
            },
          };
          inputs.push(input);
          return input;
        },
      },
    };
    const [image] = await pickAttachments(root, "web", "image");
    expect(inputs[0]).toMatchObject({ type: "file", multiple: true, accept: "image/*" });
    expect(image).toMatchObject({ kind: "image", fileName: "shot.png", mimeType: "image/png", data: b64("png!") });
    const [file] = await pickAttachments(root, "web", "file");
    expect(inputs[1]?.accept).toBeUndefined();
    expect(file?.kind).toBe("file");
  });

  it("resolves with nothing when the chooser is closed", async () => {
    const root = {
      FileReader: FakeReader,
      document: {
        createElement() {
          const listeners: Record<string, () => void> = {};
          return { addEventListener: (type: string, listener: () => void) => (listeners[type] = listener), click: () => listeners.cancel?.() };
        },
      },
    };
    expect(await pickAttachments(root, "web", "file")).toEqual([]);
  });
});

describe("imagesFromPaste", () => {
  it("takes only the images of a paste", async () => {
    const images = await imagesFromPaste({ FileReader: FakeReader }, { files: [{ name: "a.txt", type: "text/plain", content: "x" }, { name: "image.png", type: "image/png", content: "img" }] });
    expect(images.map(({ fileName, data }) => ({ fileName, data }))).toEqual([{ fileName: "image.png", data: b64("img") }]);
  });

  it("is empty for a paste of words", async () => {
    expect(await imagesFromPaste({ FileReader: FakeReader }, { files: [] })).toEqual([]);
    expect(await imagesFromPaste({ FileReader: FakeReader }, null)).toEqual([]);
  });
});

describe("droppedFilesAsAttachments", () => {
  it("attaches dropped raster images as images and everything else as files, in the order dropped", async () => {
    const dropped = await droppedFilesAsAttachments({ FileReader: FakeReader }, [
      { name: "screenshot.png", type: "image/png", content: "png" },
      { name: "report.pdf", type: "application/pdf", content: "pdf" },
      { name: "logo.svg", type: "image/svg+xml", content: "<svg/>" },
      { name: "photo.jpg", type: "image/jpg", content: "jpg" },
    ]);
    expect(dropped.map(({ kind, fileName, mimeType, data }) => ({ kind, fileName, mimeType, data }))).toEqual([
      { kind: "image", fileName: "screenshot.png", mimeType: "image/png", data: b64("png") },
      { kind: "file", fileName: "report.pdf", mimeType: "application/pdf", data: b64("pdf") },
      { kind: "file", fileName: "logo.svg", mimeType: "image/svg+xml", data: b64("<svg/>") },
      { kind: "image", fileName: "photo.jpg", mimeType: "image/jpeg", data: b64("jpg") },
    ]);
    expect(new Set(dropped.map((item) => item.id)).size).toBe(4);
  });

  it("judges a file the system gave no type by its name, and sends any other untyped file as bytes", async () => {
    const dropped = await droppedFilesAsAttachments({ FileReader: FakeReader }, [
      { name: "IMG_0042.HEIC", type: "", content: "heic" },
      { name: "build.log", type: "", content: "log" },
    ]);
    expect(dropped.map(({ kind, fileName, mimeType }) => ({ kind, fileName, mimeType }))).toEqual([
      { kind: "image", fileName: "IMG_0042.HEIC", mimeType: "image/heic" },
      { kind: "file", fileName: "build.log", mimeType: "application/octet-stream" },
    ]);
  });

  it("shrinks a dropped image over the agent's limit as a picked one is, and never a file", async () => {
    const big = "x".repeat(Math.ceil((MAX_IMAGE_BASE64_LENGTH * 3) / 4) + 8);
    // No canvas here, so the image cannot be shrunk: it comes back as it was, for the composer to refuse with its message.
    const [image, file] = await droppedFilesAsAttachments({ FileReader: FakeReader }, [
      { name: "huge.png", type: "image/png", content: big },
      { name: "huge.zip", type: "application/zip", content: big },
    ]);
    expect(image).toMatchObject({ kind: "image", fileName: "huge.png", data: b64(big) });
    expect(file).toMatchObject({ kind: "file", fileName: "huge.zip", data: b64(big) });
  });

  it("is empty for a drop of nothing", async () => {
    expect(await droppedFilesAsAttachments({ FileReader: FakeReader }, [])).toEqual([]);
  });
});
