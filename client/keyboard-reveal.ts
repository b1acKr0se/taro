/**
 * The arithmetic behind keeping a focused text field above the on-screen
 * keyboard, kept pure so it can be tested. Every position is in window
 * coordinates, the space the keyboard's frame is reported in.
 */

/** A vertical stretch of the window: its top and bottom edge. */
export interface Span {
  top: number;
  bottom: number;
}

/** Space kept between a revealed field and the keyboard (or the scroll area's top), in points. */
export const REVEAL_MARGIN = 12;

/**
 * How much of a scroll area the keyboard covers: the room to add at the end of
 * its content so the last field can still be scrolled above the keyboard.
 */
export function keyboardRoom(area: Span, keyboardTop: number | null): number {
  if (keyboardTop === null) return 0;
  return Math.max(0, Math.round(area.bottom - Math.max(area.top, keyboardTop)));
}

/** The part of a scroll area the reader can see: above the keyboard, if one is open. */
export function visibleSpan(area: Span, keyboardTop: number | null): Span {
  return { top: area.top, bottom: keyboardTop === null ? area.bottom : Math.max(area.top, Math.min(area.bottom, keyboardTop)) };
}

/**
 * The scroll offset that shows `field` inside `visible`, from the current
 * `offset`, or null when it is shown already. A field taller than the visible
 * part is shown by its bottom, where the reader types.
 */
export function revealOffset(field: Span, visible: Span, offset: number, margin = REVEAL_MARGIN): number | null {
  const room = visible.bottom - visible.top;
  if (room <= 0) return null;
  const tall = field.bottom - field.top + 2 * margin > room;
  let shift = 0;
  if (tall || field.bottom + margin > visible.bottom) shift = field.bottom + margin - visible.bottom;
  else if (field.top - margin < visible.top) shift = field.top - margin - visible.top;
  if (Math.abs(shift) < 1) return null;
  return Math.max(0, Math.round(offset + shift));
}

/**
 * Whether a field lies in a scroll area: across, it sits within the area's
 * width (a page can hold side-by-side areas); down, anywhere, since focus can
 * land on a field scrolled out of sight. An area with no height (a hidden tab)
 * holds nothing.
 */
export function holds(area: Span & { left: number; right: number }, field: Span & { left: number; right: number }): boolean {
  if (area.bottom <= area.top) return false;
  const middleX = (field.left + field.right) / 2;
  return middleX >= area.left && middleX <= area.right;
}
