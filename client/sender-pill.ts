import type { PluginTheme } from "@getpaseo/plugin";

/** A colour's brightness from 0 to 255 when it is `#rgb`, `#rrggbb` or `rgb(…)`, else null. */
function brightness(colour: string): number | null {
  const text = colour.trim();
  let channels: number[] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(text);
  if (hex !== null) {
    const digits = hex[1] ?? "";
    const full = digits.length === 3 ? digits.split("").map((digit) => digit + digit).join("") : digits;
    channels = [0, 2, 4].map((start) => parseInt(full.slice(start, start + 2), 16));
  } else {
    const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(text);
    if (rgb !== null) channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  if (channels === null) return null;
  const [red = 0, green = 0, blue = 0] = channels;
  return 0.299 * red + 0.587 * green + 0.114 * blue;
}

/**
 * A received message's sender pill (TR-220): a solid chip that shows on the bubble in both themes. The border
 * colour does in light; in dark it is nearly the bubble's own, so the page background (darker than the bubble)
 * stands out instead. The plugin theme has no dark/light flag, so dark is text lighter than the page.
 */
export function senderPillColours(colors: PluginTheme["colors"]): { background: string; text: string } {
  const page = brightness(colors.surface0);
  const text = brightness(colors.foreground);
  const dark = page !== null && text !== null && text > page;
  return dark ? { background: colors.surface0, text: colors.foregroundMuted } : { background: colors.border, text: colors.foreground };
}
