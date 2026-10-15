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
