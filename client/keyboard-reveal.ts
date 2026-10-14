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
 * What to reveal for a field followed by its own action row (a card's Submit): both, as one
 * stretch. A row measured as empty (not laid out, or collapsed away) adds nothing.
 */
export function revealSpan(field: Span, actions: Span | null): Span {
  if (actions === null || actions.bottom <= actions.top) return field;
  return { top: Math.min(field.top, actions.top), bottom: Math.max(field.bottom, actions.bottom) };
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

/**
 * The room a scroll area needs for the keyboard, given the room it already
 * has. An area sized by its content (a `maxHeight` list) grows with the room
 * added to it; counted as the area's own height, that growth would ask for more
 * room each time. So growth since the area was last measured without room
 * (`bareHeight`), up to the room it has, is taken to be that room.
 */
export function roomNeeded(area: Span, bareHeight: number | null, room: number, keyboardTop: number | null): number {
  const grown = bareHeight === null ? 0 : Math.min(room, Math.max(0, area.bottom - area.top - bareHeight));
  return keyboardRoom({ top: area.top, bottom: area.bottom - grown }, keyboardTop);
}

/**
 * Which scroll area the focused field belongs to. A field claims its area on
 * focus; the area acts only while that same field still has focus, so a focus
 * that moved elsewhere (the composer, a modal) never scrolls it, even when the
 * new field forgot to release the claim.
 */
export function createFieldClaims<Field>() {
  let area: object | null = null;
  let field: Field | null = null;
  return {
    claim(by: object, focused: Field | null): void {
      area = by;
      field = focused;
    },
    release(): void {
      area = null;
      field = null;
    },
    /** An area going away drops its claim, if it holds it. */
    releaseArea(by: object): void {
      if (area !== by) return;
      area = null;
      field = null;
    },
    owns(by: object, focused: Field | null): boolean {
      return area === by && focused !== null && focused === field;
    },
  };
}
