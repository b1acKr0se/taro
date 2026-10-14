/**
 * How far the macOS desktop app's window controls reach into a full-window surface (TR-048). Paseo's
 * desktop app draws its window without a title bar, the traffic lights over the page's top-left corner,
 * and keeps its own screens clear of them; the plugin host does not pass that on, so this reads what
 * Paseo's app reads: the `window.paseoDesktop` object its desktop shell injects, its `windowChromeMode`,
 * else its platform or the user agent. Windows and Linux draw their controls inside the page's own
 * chrome instead, and the web and the phone have neither. Pure.
 */

/** Paseo's `DESKTOP_TRAFFIC_LIGHT_HEIGHT`: the strip its macOS window keeps for the traffic lights and dragging. */
export const MAC_WINDOW_CONTROLS_HEIGHT = 45;

/** The parts of Paseo's desktop shell object read here; anything else about it is unknown. */
export interface DesktopShell {
  platform?: unknown;
  windowChromeMode?: unknown;
}

export function isMacDesktopShell(shell: unknown, userAgent: string): boolean {
  if (typeof shell !== "object" || shell === null) return false;
  const { platform, windowChromeMode } = shell as DesktopShell;
  if (windowChromeMode === "native-mac") return true;
  if (windowChromeMode === "custom-windows" || windowChromeMode === "custom-linux") return false;
  const named = typeof platform === "string" ? platform.toLowerCase() : "";
  if (named === "darwin" || named === "mac" || named === "macos") return true;
  return userAgent.includes("Mac OS") || userAgent.includes("Macintosh");
}

/** The top inset a full-window surface keeps: the traffic lights' strip on macOS, nothing in full screen, where they hide. */
export function windowControlsInset(shell: unknown, userAgent: string, fullScreen: boolean): number {
  return !fullScreen && isMacDesktopShell(shell, userAgent) ? MAC_WINDOW_CONTROLS_HEIGHT : 0;
}
