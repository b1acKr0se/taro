import { describe, expect, it } from "vitest";

import { availableSources, canReadLocalFiles, expoModule } from "./attachment-sources";

const call = () => undefined;

/** The global object of the phone app with these native modules. */
function phone(modules: Record<string, unknown>, extra: Record<string, unknown> = {}): object {
  return { expo: { modules }, ...extra };
}

const ALL_MODULES = {
  ExponentImagePicker: { launchImageLibraryAsync: call },
  ExpoClipboard: { getImageAsync: call },
  ExpoDocumentPicker: { getDocumentAsync: call },
  ExponentFileSystem: { readAsStringAsync: call },
};

describe("expoModule", () => {
  it("finds a module that has every function Taro calls", () => {
    expect(expoModule(phone(ALL_MODULES), "imagePicker")).toBe(ALL_MODULES.ExponentImagePicker);
  });

  it("is null without expo, without its modules, or without the module", () => {
    expect(expoModule({}, "imagePicker")).toBeNull();
    expect(expoModule({ expo: null }, "imagePicker")).toBeNull();
    expect(expoModule({ expo: {} }, "imagePicker")).toBeNull();
    expect(expoModule(phone({}), "imagePicker")).toBeNull();
    expect(expoModule(phone({ ExponentImagePicker: null }), "imagePicker")).toBeNull();
  });

  it("is null when a renamed or reshaped module lacks the function", () => {
    expect(expoModule(phone({ ExponentImagePicker: {} }), "imagePicker")).toBeNull();
    expect(expoModule(phone({ ExponentImagePicker: { launchImageLibraryAsync: "not a function" } }), "imagePicker")).toBeNull();
    expect(expoModule(phone({ ExpoImagePicker: { launchImageLibraryAsync: call } }), "imagePicker")).toBeNull();
  });

  it("reads the global object when called, so a module that appears later is found", () => {
    const root: Record<string, unknown> = {};
    expect(expoModule(root, "clipboard")).toBeNull();
    root.expo = { modules: { ExpoClipboard: { getImageAsync: call } } };
    expect(expoModule(root, "clipboard")).not.toBeNull();
  });

  it("does not throw on a hostile global", () => {
    expect(expoModule({ expo: 42 }, "clipboard")).toBeNull();
    expect(expoModule({ expo: { modules: "x" } }, "clipboard")).toBeNull();
  });
});

describe("availableSources on the phone app", () => {
  it("offers all three when every module is there", () => {
    expect(availableSources(phone(ALL_MODULES), "android")).toEqual(["image", "paste", "file"]);
    expect(availableSources(phone(ALL_MODULES), "ios")).toEqual(["image", "paste", "file"]);
  });

  it("offers nothing when the app exposes no Expo modules", () => {
    expect(availableSources({}, "ios")).toEqual([]);
  });

  it("hides only the item whose module is missing", () => {
    const { ExponentImagePicker: _image, ...withoutImage } = ALL_MODULES;
    expect(availableSources(phone(withoutImage), "android")).toEqual(["paste", "file"]);
    const { ExpoClipboard: _clipboard, ...withoutClipboard } = ALL_MODULES;
    expect(availableSources(phone(withoutClipboard), "android")).toEqual(["image", "file"]);
    const { ExpoDocumentPicker: _documents, ...withoutDocuments } = ALL_MODULES;
    expect(availableSources(phone(withoutDocuments), "android")).toEqual(["image", "paste"]);
  });

  it("offers Upload file only when a picked file can be read", () => {
    const { ExponentFileSystem: _files, ...withoutFileSystem } = ALL_MODULES;
    expect(availableSources(phone(withoutFileSystem), "ios")).toEqual(["image", "paste"]);
    expect(availableSources(phone(withoutFileSystem, { fetch: call, FileReader: call }), "ios")).toEqual(["image", "paste", "file"]);
    expect(canReadLocalFiles(phone(withoutFileSystem, { fetch: call }))).toBe(false);
  });
});

describe("availableSources on the web", () => {
  const browser = (clipboard: unknown) => ({ document: { createElement: call }, FileReader: call, navigator: { clipboard } });

  it("offers all three in a browser with clipboard reading", () => {
    expect(availableSources(browser({ read: call }), "web")).toEqual(["image", "paste", "file"]);
  });

  it("hides Paste image where the browser cannot read the clipboard", () => {
    expect(availableSources(browser(undefined), "web")).toEqual(["image", "file"]);
    expect(availableSources(browser({ readText: call }), "web")).toEqual(["image", "file"]);
  });

  it("ignores the phone's modules on the web, and offers nothing without a document", () => {
    expect(availableSources(phone(ALL_MODULES), "web")).toEqual([]);
  });
});
