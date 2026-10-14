// Every font size Taro draws with, by role. Paseo's own screens follow the UI and content font
// sizes in its Settings, but `PluginTheme` carries colours only, so a plugin has no supported way to
// read them (getpaseo/paseo#6327). These are Paseo's default sizes instead — `caption` is its `sm`,
// `body` its `base`, `content` its `content`, `subtitle` its `lg`, `heading` its `xl`, `display` its
// `3xl` — so Taro matches Paseo at its defaults, and following the setting, once the theme
// carries it, is a change to this file alone.
export const FONT_SIZE = {
  /** Small capitals over a section, an attachment's size. */
  micro: 11,
  /** Meta lines, counts, timestamps, tool lines, schedules. */
  caption: 12,
  /** Secondary text: notes, buttons, prompts, errors, hints. */
  small: 13,
  /** Body text: a card's title, a reply, a file's name. */
  body: 14,
  /** Text to read or write at length: the composer, a question, a Markdown file. */
  content: 15,
  /** A panel's title, a picker's rows, a radio mark. */
  subtitle: 16,
  /** A screen's title on a phone. */
  heading: 18,
  /** A screen's title in a wide window. */
  display: 22,
  /** The file editor and a permission's command. */
  code: 13,
} as const;

/** A line height that keeps wrapped text at `size` readable: 1.6× gives a reply room between its lines (TR-016, TR-031). */
export function lineHeightFor(size: number): number {
  return Math.round(size * 1.6);
}

/**
 * A one-line label's line in a chip, pill, badge or tab (TR-089). Left to the platform, a phone measured
 * a chip from one font's metrics and drew its label in the system font lower down, cutting off the
 * descenders; a fixed line sizes the box from the line it draws, with room below the baseline, and
 * still grows with the system's font size.
 */
export function labelLineHeightFor(size: number): number {
  return Math.ceil(size * 1.35);
}
