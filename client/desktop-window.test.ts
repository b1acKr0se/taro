import { describe, expect, it, vi } from "vitest";

import { watchFullScreen } from "./desktop-window";

/** Lets every settled promise's callbacks run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

function shellWith(window: unknown): unknown {
  return { windowChromeMode: "native-mac", window: { getCurrentWindow: () => window } };
}

/** A window whose `onResized` answers with `answer(listener)` and whose full screen state is `fullScreen`. */
function standIn(answer: (listener: () => void) => unknown, fullScreen = { value: false }) {
  const listeners: Array<() => void> = [];
  const window = {
    isFullscreen: vi.fn(() => Promise.resolve(fullScreen.value)),
    onResized: vi.fn((listener: () => void) => {
      listeners.push(listener);
      return answer(listener);
    }),
  };
  const resize = (value: boolean) => {
    fullScreen.value = value;
    listeners.forEach((listener) => listener());
  };
  return { window, resize };
}

describe("watchFullScreen", () => {
  it("follows full screen when onResized answers with a promise of an unsubscribe", async () => {
    const unsubscribe = vi.fn();
    const { window, resize } = standIn(() => Promise.resolve(unsubscribe));
    const seen: boolean[] = [];
    const stop = watchFullScreen(shellWith(window), (value) => seen.push(value));
    await settle();
    resize(true);
    await settle();
    expect(seen).toEqual([false, true]);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("follows full screen when onResized answers with a plain unsubscribe, as the desktop app does", async () => {
    const unsubscribe = vi.fn();
    const { window, resize } = standIn(() => unsubscribe);
    const seen: boolean[] = [];
    const stop = watchFullScreen(shellWith(window), (value) => seen.push(value));
    await settle();
    resize(true);
    await settle();
    expect(seen).toEqual([false, true]);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reads full screen once when onResized answers with nothing", async () => {
    const { window } = standIn(() => undefined, { value: true });
    const seen: boolean[] = [];
    const stop = watchFullScreen(shellWith(window), (value) => seen.push(value));
    await settle();
    expect(seen).toEqual([true]);
    expect(() => stop()).not.toThrow();
  });

  it("survives onResized throwing, or answering with a rejection or something that is not a function", async () => {
    const answers: Array<(listener: () => void) => unknown> = [
      () => {
        throw new Error("no resize events");
      },
      () => Promise.reject(new Error("no resize events")),
      () => 42,
      () => Promise.resolve("not a function"),
      () => ({ then: "not a function" }),
    ];
    for (const answer of answers) {
      const { window } = standIn(answer);
      const seen: boolean[] = [];
      let stop: () => void = () => undefined;
      expect(() => {
        stop = watchFullScreen(shellWith(window), (value) => seen.push(value));
      }).not.toThrow();
      await settle();
      expect(seen).toEqual([false]);
      expect(() => stop()).not.toThrow();
    }
  });

  it("unsubscribes when the promise of an unsubscribe settles after the stop", async () => {
    const unsubscribe = vi.fn();
    let deliver: (stop: () => void) => void = () => undefined;
    const { window } = standIn(() => new Promise<() => void>((resolve) => (deliver = resolve)));
    const stop = watchFullScreen(shellWith(window), () => undefined);
    stop();
    deliver(unsubscribe);
    await settle();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("never reports after the stop", async () => {
    const { window, resize } = standIn(() => () => undefined);
    const seen: boolean[] = [];
    const stop = watchFullScreen(shellWith(window), (value) => seen.push(value));
    stop();
    resize(true);
    await settle();
    expect(seen).toEqual([]);
  });

  it("swallows an unsubscribe that throws", async () => {
    const { window } = standIn(() => () => {
      throw new Error("already gone");
    });
    const stop = watchFullScreen(shellWith(window), () => undefined);
    await settle();
    expect(() => stop()).not.toThrow();
  });

  it("takes isFullscreen answering with a plain boolean, and treats anything else as not full screen", async () => {
    const answers: Array<[() => unknown, boolean[]]> = [
      [() => true, [true]],
      [() => Promise.resolve(true), [true]],
      [() => "yes", [false]],
      [() => undefined, [false]],
      [() => Promise.reject(new Error("no window")), []],
      [
        () => {
          throw new Error("no window");
        },
        [],
      ],
    ];
    for (const [isFullscreen, expected] of answers) {
      const seen: boolean[] = [];
      expect(() => watchFullScreen(shellWith({ isFullscreen, onResized: () => () => undefined }), (value) => seen.push(value))).not.toThrow();
      await settle();
      expect(seen).toEqual(expected);
    }
  });

  it("does nothing, and never throws, when the shell or its window is missing or malformed", async () => {
    const throwing = () => {
      throw new Error("no window");
    };
    const getterThatThrows = {
      get window() {
        throw new Error("no window");
      },
    };
    const shells: unknown[] = [
      undefined,
      null,
      "desktop",
      {},
      { window: null },
      { window: { getCurrentWindow: "not a function" } },
      { window: { getCurrentWindow: throwing } },
      { window: { getCurrentWindow: () => null } },
      shellWith({}),
      shellWith({ isFullscreen: "no", onResized: "no" }),
      shellWith({
        get isFullscreen() {
          throw new Error("no window");
        },
        get onResized() {
          throw new Error("no window");
        },
      }),
      getterThatThrows,
    ];
    for (const shell of shells) {
      const seen: boolean[] = [];
      let stop: () => void = () => undefined;
      expect(() => {
        stop = watchFullScreen(shell, (value) => seen.push(value));
      }).not.toThrow();
      await settle();
      expect(seen).toEqual([]);
      expect(() => stop()).not.toThrow();
    }
  });
});
