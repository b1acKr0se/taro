/**
 * Which ways of attaching work on this client (TR-036). The plugin SDK has no picker or clipboard
 * read, so the web uses the browser's own APIs and the phone app the Expo modules Paseo's app ships
 * for its own composer, reached through `globalThis.expo.modules` — undocumented for plugins, so a
 * Paseo update may rename or drop one (README, AGENTS.md). Everything here reads `root` (the global
 * object) when called, never at module scope: the bundle must load in Hermes whatever is missing,
 * and a missing module only hides its item.
 */

export type AttachmentSource = "image" | "paste" | "file";

/** The sheet's items, in the order Paseo's own sheet lists them. */
export const ATTACHMENT_SOURCES: readonly { source: AttachmentSource; label: string; icon: string }[] = [
  { source: "image", label: "Add image", icon: "Image" },
  { source: "paste", label: "Paste image", icon: "ClipboardPaste" },
  { source: "file", label: "Upload file", icon: "Paperclip" },
];

/** The native module names and the functions Taro calls on each (expo-image-picker 17, expo-clipboard 8, expo-document-picker 14, expo-file-system 19, expo-image-manipulator 14 to shrink images, TR-037). */
export const EXPO_MODULES = {
  imagePicker: { name: "ExponentImagePicker", methods: ["launchImageLibraryAsync"] },
  clipboard: { name: "ExpoClipboard", methods: ["getImageAsync"] },
  documentPicker: { name: "ExpoDocumentPicker", methods: ["getDocumentAsync"] },
  fileSystem: { name: "ExponentFileSystem", methods: ["readAsStringAsync"] },
  imageManipulator: { name: "ExpoImageManipulator", methods: ["manipulate"] },
} as const;

export type ExpoModuleKey = keyof typeof EXPO_MODULES;

type Methods = Record<string, (...args: unknown[]) => unknown>;

function read(value: unknown, key: string): unknown {
  return (typeof value === "object" || typeof value === "function") && value !== null ? Reflect.get(value, key) : undefined;
}

/** The app's native module `key` when it is there with every function Taro calls, else null. */
export function expoModule(root: object, key: ExpoModuleKey): Methods | null {
  const { name, methods } = EXPO_MODULES[key];
  const found = read(read(read(root, "expo"), "modules"), name);
  if (found === undefined || found === null) return null;
  return methods.every((method) => typeof read(found, method) === "function") ? (found as Methods) : null;
}

/** Whether a picked file's content can be read on the phone: the file system module, else `fetch` and `FileReader`. */
export function canReadLocalFiles(root: object): boolean {
  return expoModule(root, "fileSystem") !== null || (typeof read(root, "fetch") === "function" && typeof read(root, "FileReader") === "function");
}

/** The sources this client can offer now; `platform` is `Platform.OS`. */
export function availableSources(root: object, platform: string): AttachmentSource[] {
  if (platform === "web") {
    const document = read(root, "document");
    const canPick = typeof read(document, "createElement") === "function" && typeof read(root, "FileReader") === "function";
    const canPaste = typeof read(read(read(root, "navigator"), "clipboard"), "read") === "function";
    return ATTACHMENT_SOURCES.map((item) => item.source).filter((source) => (source === "paste" ? canPaste : canPick));
  }
  const present: Record<AttachmentSource, boolean> = {
    image: expoModule(root, "imagePicker") !== null,
    paste: expoModule(root, "clipboard") !== null,
    file: expoModule(root, "documentPicker") !== null && canReadLocalFiles(root),
  };
  return ATTACHMENT_SOURCES.map((item) => item.source).filter((source) => present[source]);
}
