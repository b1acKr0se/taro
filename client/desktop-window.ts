/**
 * Whether the macOS desktop app's window is in full screen, where its traffic lights hide (TR-048),
 * read from the undocumented `window.paseoDesktop` object its shell injects. The shape of its window
 * object is not ours: the desktop app's `onResized` answers with a plain unsubscribe where a promise
 * of one was assumed, and calling `.then` on it took the whole plugin down when an image was opened
 * (TR-054). Paseo's own app awaits whatever each call returns, so this does the same: every call is
 * feature-detected, a promise, a plain value or nothing is accepted, every throw and rejection is
 * swallowed, and anything unexpected reads as not full screen. Pure, apart from the shell it is given.
 */

/** Calls `call`, turning a throw into a rejection, and a plain value into a promise of it. */
function attempt(call: () => unknown): Promise<unknown> {
  try {
    return Promise.resolve(call());
  } catch (error) {
    return Promise.reject(error);
  }
}

function desktopWindowOf(shell: unknown): Record<string, unknown> | null {
  try {
    const open = (shell as { window?: { getCurrentWindow?: unknown } } | null)?.window?.getCurrentWindow;
    if (typeof open !== "function") return null;
    const found: unknown = open();
    return typeof found === "object" && found !== null ? (found as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Reports the window's full screen state now and on each resize until the returned stop is called;
 * reports nothing when the shell offers no way to read it. Neither this nor the stop ever throws.
 */
export function watchFullScreen(shell: unknown, onChange: (fullScreen: boolean) => void): () => void {
  const window = desktopWindowOf(shell);
  if (window === null) return () => undefined;
  let live = true;
  let unsubscribe: (() => void) | undefined;
  const release = (stop: unknown) => {
    if (typeof stop === "function") void attempt(() => stop.call(undefined)).catch(() => undefined);
  };
  const read = () => {
    const isFullscreen = window.isFullscreen;
    if (typeof isFullscreen !== "function") return;
    attempt(() => isFullscreen.call(window))
      .then((value) => {
        if (live) onChange(value === true);
      })
      .catch(() => undefined);
  };
  read();
  // Entering or leaving full screen resizes the window; the traffic lights hide and return with it.
  const onResized = window.onResized;
  if (typeof onResized === "function") {
    attempt(() => onResized.call(window, read))
      .then((stop) => {
        if (live) unsubscribe = typeof stop === "function" ? (stop as () => void) : undefined;
        else release(stop);
      })
      .catch(() => undefined);
  }
  return () => {
    live = false;
    release(unsubscribe);
    unsubscribe = undefined;
  };
}
