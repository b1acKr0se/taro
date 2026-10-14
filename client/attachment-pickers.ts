/**
 * Getting attachments from the user (TR-036): a browser's file input and clipboard on the web, the
 * app's Expo modules on the phone (`attachment-sources.ts` says which are there). Each resolves to the
 * picked attachments, an empty list when the user cancels, or rejects with a sentence. Called with
 * the global object, never reading it at module scope.
 */
import { imageFileName, parseDataUrl, type DraftAttachment } from "../shared/attachments";
import { expoModule, type AttachmentSource } from "./attachment-sources";

type Loose = Record<string, unknown>;

let nextId = 0;
function attachmentId(): string {
  nextId += 1;
  return `${Date.now().toString(36)}-${nextId}`;
}

function asList(value: unknown): Loose[] {
  return Array.isArray(value) ? value.filter((item): item is Loose => typeof item === "object" && item !== null) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A Blob or File as base64, through the `FileReader` both browsers and React Native have. */
function readBlob(root: Loose, blob: unknown): Promise<{ mimeType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const Reader = root.FileReader as new () => {
      result: unknown;
      onload: (() => void) | null;
      onerror: (() => void) | null;
      readAsDataURL(blob: unknown): void;
    };
    const reader = new Reader();
    reader.onload = () => {
      const parsed = typeof reader.result === "string" ? parseDataUrl(reader.result) : null;
      if (parsed === null) reject(new Error("That file could not be read."));
      else resolve(parsed);
    };
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------- web

/** Opens the browser's file chooser; resolves with the chosen files, or none when it is closed. */
function chooseWebFiles(root: Loose, accept: string | null): Promise<unknown[]> {
  return new Promise((resolve) => {
    const document = root.document as { createElement(tag: string): Loose & { click(): void; addEventListener(type: string, listener: () => void, options?: unknown): void } };
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (accept !== null) input.accept = accept;
    input.addEventListener("change", () => resolve(Array.from((input.files as ArrayLike<unknown> | null) ?? [])));
    // Closing the chooser without a choice fires `cancel` where browsers support it; elsewhere nothing resolves, which leaves nothing behind.
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

async function webFilesAsAttachments(root: Loose, files: unknown[], kind: DraftAttachment["kind"]): Promise<DraftAttachment[]> {
  return Promise.all(
    files.map(async (file, index) => {
      const { mimeType, data } = await readBlob(root, file);
      const type = text((file as Loose).type) ?? mimeType;
      return { id: attachmentId(), kind, fileName: text((file as Loose).name) ?? imageFileName(type, index), mimeType: type, data };
    }),
  );
}

async function pasteWebImage(root: Loose): Promise<DraftAttachment[]> {
  const clipboard = (root.navigator as { clipboard: { read(): Promise<{ types: readonly string[]; getType(type: string): Promise<unknown> }[]> } }).clipboard;
  let items: Awaited<ReturnType<typeof clipboard.read>>;
  try {
    items = await clipboard.read();
  } catch {
    throw new Error("The browser did not let Taro read the clipboard. Allow it, or paste into the message field.");
  }
  const images = items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).slice(0, 1).map((type) => ({ item, type })));
  if (images.length === 0) throw new Error("There is no image on the clipboard.");
  return Promise.all(
    images.map(async ({ item, type }, index) => {
      const { data } = await readBlob(root, await item.getType(type));
      return { id: attachmentId(), kind: "image" as const, fileName: imageFileName(type, index), mimeType: type, data };
    }),
  );
}

/** The images in a browser paste event's clipboard data, read; none when it holds no image. */
export async function imagesFromPaste(root: object, clipboardData: unknown): Promise<DraftAttachment[]> {
  const files = Array.from(((clipboardData as Loose | null)?.files as ArrayLike<unknown> | undefined) ?? []).filter((file) => String((file as Loose).type).startsWith("image/"));
  return webFilesAsAttachments(root as Loose, files, "image");
}

// ---------------------------------------------------------------- phone

/** A picked file's content as base64, through the file system module or `fetch` and `FileReader`. */
async function readLocalFile(root: Loose, uri: string): Promise<string> {
  const fileSystem = expoModule(root, "fileSystem");
  if (fileSystem !== null) {
    const content = await fileSystem.readAsStringAsync?.(uri, { encoding: "base64" });
    if (typeof content === "string") return content;
  }
  const fetchFile = root.fetch as (this: unknown, uri: string) => Promise<{ blob(): Promise<unknown> }>;
  return (await readBlob(root, await (await fetchFile.call(root, uri)).blob())).data;
}

async function pickPhoneImages(root: Loose): Promise<DraftAttachment[]> {
  const picker = expoModule(root, "imagePicker");
  if (picker === null) throw new Error("This app cannot pick images.");
  // As Paseo's composer does: ask for the photo library first where the module can.
  if (typeof picker.requestMediaLibraryPermissionsAsync === "function") {
    const permission = (await picker.requestMediaLibraryPermissionsAsync(false)) as Loose | null;
    if (permission !== null && permission.granted === false) throw new Error("Allow Paseo to read your photos in the phone's settings.");
  }
  const result = (await picker.launchImageLibraryAsync?.({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.8, base64: true })) as Loose | null;
  if (result === null || result.canceled === true) return [];
  return Promise.all(
    asList(result.assets).map(async (asset, index) => {
      const mimeType = text(asset.mimeType) ?? "image/jpeg";
      const data = text(asset.base64) ?? (await readLocalFile(root, String(asset.uri)));
      return { id: attachmentId(), kind: "image" as const, fileName: text(asset.fileName) ?? imageFileName(mimeType, index), mimeType, data };
    }),
  );
}

async function pastePhoneImage(root: Loose): Promise<DraftAttachment[]> {
  const clipboard = expoModule(root, "clipboard");
  if (clipboard === null) throw new Error("This app cannot read images from the clipboard.");
  const image = (await clipboard.getImageAsync?.({ format: "png", jpegQuality: 1 })) as Loose | null;
  const parsed = image === null ? null : parseDataUrl(String(image.data));
  if (parsed === null) throw new Error("There is no image on the clipboard.");
  return [{ id: attachmentId(), kind: "image", fileName: imageFileName(parsed.mimeType, 0), mimeType: parsed.mimeType, data: parsed.data }];
}

async function pickPhoneFiles(root: Loose): Promise<DraftAttachment[]> {
  const documents = expoModule(root, "documentPicker");
  if (documents === null) throw new Error("This app cannot pick files.");
  const result = (await documents.getDocumentAsync?.({ type: ["*/*"], copyToCacheDirectory: true, multiple: true })) as Loose | null;
  if (result === null || result.canceled === true) return [];
  return Promise.all(
    asList(result.assets).map(async (asset) => ({
      id: attachmentId(),
      kind: "file" as const,
      fileName: text(asset.name) ?? "file",
      mimeType: text(asset.mimeType) ?? "application/octet-stream",
      data: await readLocalFile(root, String(asset.uri)),
    })),
  );
}

/** Runs one of the sheet's items on this client; `platform` is `Platform.OS`. */
export function pickAttachments(root: object, platform: string, source: AttachmentSource): Promise<DraftAttachment[]> {
  const global = root as Loose;
  if (platform === "web") {
    if (source === "paste") return pasteWebImage(global);
    return chooseWebFiles(global, source === "image" ? "image/*" : null).then((files) => webFilesAsAttachments(global, files, source === "image" ? "image" : "file"));
  }
  if (source === "image") return pickPhoneImages(global);
  if (source === "paste") return pastePhoneImage(global);
  return pickPhoneFiles(global);
}
