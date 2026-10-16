import type { PullRequestTone } from "../shared/pull-request-state";
import { contrastRatio, rgbOf } from "./control-colors";

/**
 * GitHub's merged purple (`done.fg` in its Primer themes), the one colour outside `theme.colors`
 * on a card (TR-114): the user asked for GitHub's own merged icon, and Paseo's theme has no purple.
 */
export const GITHUB_MERGED = { light: "#8250df", dark: "#a371f7" } as const;

const WHITE = [255, 255, 255] as const;
const BLACK = [0, 0, 0] as const;

/** The merged purple for the theme in use: a light foreground means a dark theme. Not hex → the light theme's. */
export function mergedPurple(colors: { readonly foreground: string }): string {
  const foreground = rgbOf(colors.foreground);
  if (foreground === null) return GITHUB_MERGED.light;
  return contrastRatio(foreground, BLACK) > contrastRatio(foreground, WHITE) ? GITHUB_MERGED.dark : GITHUB_MERGED.light;
}

/** A PR mark's colour (TR-152): green and red are the theme's own, so only the merged purple sits outside it. */
export function pullRequestColor(tone: PullRequestTone, colors: { readonly foreground: string; readonly foregroundMuted: string; readonly statusSuccess: string; readonly statusDanger: string }): string {
  if (tone === "merged") return mergedPurple(colors);
  if (tone === "open") return colors.statusSuccess;
  if (tone === "closed") return colors.statusDanger;
  return colors.foregroundMuted;
}
