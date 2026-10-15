import { SPACE } from "./spacing";
import { withAlpha } from "./tint";

/**
 * The fill and border of every outlined control: a button, a chip, a pill, a segmented track
 * (TR-093). Drawn in the panel's own tokens (`surface1`, `border`), a button vanished on the
 * panel behind it: Resume on the ticket summary measured 1.00:1. The foreground made translucent
 * lifts a control off whichever surface it sits on, and the border's alpha is the least that
 * reaches WCAG's 3:1 for a control's boundary against every surface of the theme in use.
 */
export interface ControlColors {
  fill: string;
  /** A chosen tab or segment among plain ones: twice the lift. */
  selectedFill: string;
  border: string;
  /** The accent as a control's outline (a recommended chip, a card's action): the theme's accent, made lighter or darker toward the foreground only as far as 3:1 needs. */
  accentBorder: string;
}

/** WCAG 2.2, 1.4.11 Non-text Contrast: a control's visible boundary against what is around it. */
export const CONTROL_BORDER_CONTRAST = 3;
/** Enough to raise the face without reading as a filled button beside the accent ones. */
const FILL_ALPHA = 0.1;
const SELECTED_FILL_ALPHA = 0.2;
const BORDER_ALPHA_FLOOR = 0.3;
const BORDER_ALPHA_STEP = 0.02;
/** Where the colours are not hex (the contrast cannot be measured), and the ceiling of the search. */
const BORDER_ALPHA_FALLBACK = 0.45;
const BORDER_ALPHA_CEILING = 0.8;

interface ThemeColors {
  readonly surface0: string;
  readonly surface1: string;
  readonly surface2: string;
  readonly foreground: string;
  readonly accent: string;
}

export function controlColors(colors: ThemeColors): ControlColors {
  return {
    fill: withAlpha(colors.foreground, FILL_ALPHA),
    selectedFill: withAlpha(colors.foreground, SELECTED_FILL_ALPHA),
    border: withAlpha(colors.foreground, borderAlpha(colors)),
    accentBorder: accentBorder(colors),
  };
}

/** Paseo's default dark accent is 2.83:1 on its cards; blending in the foreground lifts it to 3:1. */
function accentBorder(colors: ThemeColors): string {
  const accent = rgbOf(colors.accent);
  const foreground = rgbOf(colors.foreground);
  const surfaces = [colors.surface0, colors.surface1, colors.surface2].map(rgbOf);
  if (accent === null || foreground === null || surfaces.some((surface) => surface === null)) return colors.accent;
  for (let share = 0; share <= 1; share = Math.round((share + BORDER_ALPHA_STEP) * 100) / 100) {
    const edge = over(foreground, accent, share);
    if (surfaces.every((surface) => contrastRatio(edge, surface as Rgb) >= CONTROL_BORDER_CONTRAST)) return share === 0 ? colors.accent : hexOf(edge);
  }
  return colors.foreground;
}

function hexOf(color: Rgb): string {
  return `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The small button at the end of a whole-row press target (the chat's Show, the owner pane's Open):
 * the row takes the press, and this makes it read as one.
 */
export function rowButtonStyle(colors: ThemeColors) {
  const control = controlColors(colors);
  return { paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xxs, borderRadius: 6, borderWidth: 1, borderColor: control.border, backgroundColor: control.fill };
}

function borderAlpha(colors: ThemeColors): number {
  const foreground = rgbOf(colors.foreground);
  const surfaces = [colors.surface0, colors.surface1, colors.surface2].map(rgbOf);
  if (foreground === null || surfaces.some((surface) => surface === null)) return BORDER_ALPHA_FALLBACK;
  for (let alpha = BORDER_ALPHA_FLOOR; alpha <= BORDER_ALPHA_CEILING; alpha = Math.round((alpha + BORDER_ALPHA_STEP) * 100) / 100) {
    const reaches = surfaces.every((surface) => contrastRatio(over(foreground, surface as Rgb, alpha), surface as Rgb) >= CONTROL_BORDER_CONTRAST);
    if (reaches) return alpha;
  }
  return BORDER_ALPHA_CEILING;
}

export type Rgb = readonly [number, number, number];

/** A `#rgb` or `#rrggbb` colour's channels; null for anything else. */
export function rgbOf(color: string): Rgb | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  const hex = short === null ? color : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const channel = (start: number) => parseInt(hex.slice(start, start + 2), 16);
  return [channel(1), channel(3), channel(5)];
}

/** `top` drawn at `alpha` over `bottom`, as the screen shows it, rounded to whole channels. */
export function over(top: Rgb, bottom: Rgb, alpha: number): Rgb {
  const mix = (above: number, below: number) => Math.round(above * alpha + below * (1 - alpha));
  return [mix(top[0], bottom[0]), mix(top[1], bottom[1]), mix(top[2], bottom[2])];
}

/** WCAG's contrast ratio between two opaque colours, from 1 to 21. */
export function contrastRatio(first: Rgb, second: Rgb): number {
  const [one, other] = [luminance(first), luminance(second)];
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);
}

function luminance(color: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}
