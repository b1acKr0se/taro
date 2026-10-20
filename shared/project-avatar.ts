/**
 * A project's letter avatar, ported from Paseo's sidebar (`packages/app/src/styles/identity-colors.ts`,
 * `src/utils/project-display-name.ts` and `src/components/project-icon-view.tsx`, tag v0.11.2,
 * Apache-2.0; THIRD_PARTY_NOTICES.md): a rounded square holding the name's first letter in white, its
 * colour one of ten muted tones picked by hashing the name.
 */

/** Order is load-bearing: the hash indexes into it, so reordering recolours every avatar (as in Paseo). */
export const AVATAR_COLORS = [
  "#7a6aa8", // violet
  "#3d7ea6", // sky
  "#388068", // emerald
  "#a4673a", // orange
  "#b05c80", // pink
  "#6a70b8", // indigo
  "#368080", // teal
  "#b06260", // red
  "#8f7838", // amber
  "#5179b0", // blue
] as const;

/** The letter is white on every tone, in either theme (Paseo draws it so). */
export const AVATAR_LETTER_COLOR = "#ffffff";

/** Paseo's rounded corner as a fraction of the box. */
const RADIUS_RATIO = 0.25;

function hashName(name: string): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return hash;
}

export function avatarColor(name: string): string {
  return AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/** The first letter, upper-cased; a name with none (empty, spaces) shows "?". */
export function avatarLetter(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? "?" : first.toUpperCase();
}

export function avatarRadius(size: number): number {
  return Math.round(size * RADIUS_RATIO);
}
