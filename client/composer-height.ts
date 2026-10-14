/**
 * The composer's measurements, as Paseo's own composer takes them (TR-039). Values and rules are
 * ported from Paseo (`packages/app/src/composer/input/input.tsx` at v0.11.2),
 * Copyright (c) 2025-present Mohamed Boudra, licensed under the Apache License, Version 2.0
 * (see THIRD_PARTY_NOTICES.md). Changed: Paseo's unistyles breakpoints and theme tokens are
 * written out as numbers, and the per-platform choices are one pure function, so they are tested.
 */

/** The +, the context ring's slot and the send button: one size, a matched set (TR-027, TR-036). */
export const COMPOSER_CONTROL_SIZE = 28;

/** Paseo's `md` breakpoint: from this window width the composer takes its roomier padding. */
export const COMPOSER_WIDE_WIDTH = 720;

/** Paseo's `content` font size and, on the web, its 1.4× line height. Native sets no line height. */
export const COMPOSER_FONT_SIZE = 15;
export const COMPOSER_WEB_LINE_HEIGHT = COMPOSER_FONT_SIZE * 1.4;

const DEFAULT_MAX_INPUT_HEIGHT = 160;
const MAX_INPUT_VIEWPORT_RATIO = 0.5;

export interface ComposerMetrics {
  /** The field's height with nothing typed. */
  minHeight: number;
  /** The +, send and ring icons. */
  iconSize: number;
  /** The context ring's own diameter inside its slot. */
  ringSize: number;
  paddingTop: number;
  paddingBottom: number;
  paddingHorizontal: number;
}

/**
 * Paseo splits these by platform and window width, so they match its composer beside them: a web
 * field starts two lines tall with 16 px icons, the phone app's one line with 20 px icons; the
 * padding follows the window's width; the ring is 16 px on a narrow window, else the icon size.
 */
export function composerMetrics(web: boolean, windowWidth: number): ComposerMetrics {
  const wide = windowWidth >= COMPOSER_WIDE_WIDTH;
  const iconSize = web ? 16 : 20;
  return {
    minHeight: web ? 46 : 30,
    iconSize,
    ringSize: wide ? iconSize : 16,
    paddingTop: wide ? 16 : 8,
    paddingBottom: wide ? 12 : 8,
    paddingHorizontal: wide ? 16 : 12,
  };
}

/** How tall the field may grow before it scrolls inside: half the window, never under 160. */
export function composerMaxHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return DEFAULT_MAX_INPUT_HEIGHT;
  return Math.max(DEFAULT_MAX_INPUT_HEIGHT, Math.floor(windowHeight * MAX_INPUT_VIEWPORT_RATIO));
}

/** What the hidden copy of the field holds: a trailing new line takes a line in the field, but not in a copy whose value ends there. */
export function mirrorValue(draft: string): string {
  return draft.endsWith("\n") ? `${draft} ` : draft;
}

/** A field not laid out yet (0 px, or no number) is not measured: its copy would wrap every character. */
export function measurableWidth(width: number): boolean {
  return width > 0;
}

/** On the web the field scrolls inside only once it has reached its maximum, as Paseo's does; below, it grows. */
export function composerScrollEnabled(height: number, maxHeight: number): boolean {
  return height >= maxHeight;
}

/** A measured text height held between the field's minimum and maximum. */
export function boundedComposerHeight(measured: number, minHeight: number, maxHeight: number): number {
  return Math.max(minHeight, Math.min(maxHeight, measured));
}
