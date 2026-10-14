/**
 * Where a one-line label's capitals sit in its line, and how far to move them to its middle (TR-092).
 *
 * React Native lays a line out as CSS does: half the spare line height above the font's ascent and
 * half below its descent, so the line's middle is the middle of ascent and descent, not of the
 * letters. A font that keeps more room above its letters than below (the phone's system font, with
 * its room for accents) draws every label low beside an icon centred by its box. A fixed line height
 * (TR-089) only adds equal space around that same box. On Android, `includeFontPadding: false`
 * changes only the first line's top and the last line's bottom when no line height is set; with one,
 * the line height span already sets them from ascent and descent, so it changes nothing here, and
 * `textAlignVertical: "center"` acts only when the view is taller than its text, which a label's is not.
 * The platform reports the baseline and capital height of the font it used (`onTextLayout`), so the
 * label moves by the gap between the two middles, for any font and font size.
 */

/**
 * The part of an `onTextLayout` line this needs, in points. `ascender` is the line's top to its
 * baseline, line height included: Android reports the line's ascent after the line height span,
 * iOS the baseline's place in the line.
 */
export type LabelLine = { height: number; ascender: number; capHeight: number };

/** How far down (negative: up) to move a label so its capitals' middle is its line's middle, to a quarter point; 0 without a usable line. */
export function capCentreShift(line: LabelLine | undefined): number {
  if (line === undefined) return 0;
  const { height, ascender, capHeight } = line;
  if (![height, ascender, capHeight].every(Number.isFinite) || height <= 0 || capHeight <= 0) return 0;
  // The line's middle less the capitals' middle, both measured down from the line's top.
  const shift = height / 2 - (ascender - capHeight / 2);
  // A shift past half the line is a broken report, not a font.
  if (Math.abs(shift) > height / 2) return 0;
  return Math.round(shift * 4) / 4 || 0;
}

/** What a label's shift depends on: the font, its size and weight, the line height and the system font scale, never the text. */
export function labelFontKey(font: { fontSize?: number | undefined; lineHeight?: number | undefined; fontWeight?: string | number | undefined; fontFamily?: string | undefined }, fontScale: number): string {
  return [font.fontFamily ?? "", font.fontSize ?? "", font.fontWeight ?? "", font.lineHeight ?? "", fontScale].join("|");
}

/** Shifts measured so far by font key, and who to tell when one arrives: each font and size is measured once. */
export type ShiftStore = {
  get(key: string): number | undefined;
  set(key: string, shift: number): void;
  subscribe(listener: () => void): () => void;
};

export function createShiftStore(shifts: Map<string, number>): ShiftStore {
  const listeners = new Set<() => void>();
  return {
    get: (key) => shifts.get(key),
    set(key, shift) {
      if (shifts.get(key) === shift) return;
      shifts.set(key, shift);
      Array.from(listeners).map((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
