/**
 * A translucent version of a theme colour, for tinted panels and badges: the theme gives solid
 * colours only, so a tint appends an alpha byte to the hex form.
 */
export function withAlpha(color: string, alpha: number): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  const hex = short === null ? color : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  // Anything that is not a plain hex colour (rgb(), a name, one with alpha already) is drawn as it is.
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return color;
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${hex}${byte.toString(16).padStart(2, "0")}`;
}
