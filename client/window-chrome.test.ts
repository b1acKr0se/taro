import { describe, expect, it } from "vitest";

import { isMacDesktopShell, MAC_WINDOW_CONTROLS_HEIGHT, windowControlsInset } from "./window-chrome";

const MAC_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Paseo Chrome/140 Electron/38 Safari/537.36";
const LINUX_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";

describe("isMacDesktopShell", () => {
  it("is false outside the desktop app, whatever the browser runs on", () => {
    expect(isMacDesktopShell(undefined, MAC_AGENT)).toBe(false);
    expect(isMacDesktopShell(null, MAC_AGENT)).toBe(false);
    expect(isMacDesktopShell("darwin", MAC_AGENT)).toBe(false);
  });

  it("follows the shell's window chrome mode first", () => {
    expect(isMacDesktopShell({ windowChromeMode: "native-mac" }, LINUX_AGENT)).toBe(true);
    expect(isMacDesktopShell({ windowChromeMode: "custom-windows", platform: "darwin" }, MAC_AGENT)).toBe(false);
    expect(isMacDesktopShell({ windowChromeMode: "custom-linux" }, MAC_AGENT)).toBe(false);
  });

  it("falls back to the platform, in any case, then the user agent", () => {
    expect(isMacDesktopShell({ platform: "Darwin" }, LINUX_AGENT)).toBe(true);
    expect(isMacDesktopShell({ platform: "macos" }, LINUX_AGENT)).toBe(true);
    expect(isMacDesktopShell({ platform: "linux" }, LINUX_AGENT)).toBe(false);
    expect(isMacDesktopShell({ platform: "win32" }, LINUX_AGENT)).toBe(false);
    expect(isMacDesktopShell({}, MAC_AGENT)).toBe(true);
    expect(isMacDesktopShell({ windowChromeMode: "something-new" }, LINUX_AGENT)).toBe(false);
  });
});

describe("windowControlsInset", () => {
  it("keeps the traffic lights' strip in the macOS app", () => {
    expect(windowControlsInset({ windowChromeMode: "native-mac" }, MAC_AGENT, false)).toBe(MAC_WINDOW_CONTROLS_HEIGHT);
    expect(MAC_WINDOW_CONTROLS_HEIGHT).toBe(45);
  });

  it("keeps nothing in full screen, on the web, or on Windows and Linux", () => {
    expect(windowControlsInset({ windowChromeMode: "native-mac" }, MAC_AGENT, true)).toBe(0);
    expect(windowControlsInset(undefined, MAC_AGENT, false)).toBe(0);
    expect(windowControlsInset({ windowChromeMode: "custom-windows" }, LINUX_AGENT, false)).toBe(0);
  });
});
