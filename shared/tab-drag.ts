/**
 * The state of dragging a project tab (TR-214), apart from the screen so it can be tested: a press
 * held long enough lifts a tab; a move after that drags it; letting go with no move puts it back.
 */

/** A lifted tab within this many px of the row's edge scrolls the row. */
export const EDGE_PX = 40;
export const EDGE_STEP_PX = 14;

/** How far to scroll the row now: negative at the left edge, positive at the right, else 0. */
export function edgeStep(centreInView: number, viewWidth: number): number {
  if (viewWidth <= 0) return 0;
  if (centreInView < EDGE_PX) return -EDGE_STEP_PX;
  if (centreInView > viewWidth - EDGE_PX) return EDGE_STEP_PX;
  return 0;
}

export interface TabDrag {
  lifted(): string | null;
  /** Whether the finger has moved since the lift: a drag, not just a hold. */
  moved(): boolean;
  lift(name: string, scrollX: number): void;
  /** The finger moved by `dx` and the row is now at `scrollX`; returns the lifted tab's shift. */
  move(dx: number, scrollX: number): number;
  /** The row scrolled by itself (an edge scroll) while the finger stood still; returns the new shift. */
  scrolled(scrollX: number): number;
  shift(): number;
  /** The finger lifted off with no move: the tab is put back. False once a drag began. */
  cancelHold(): boolean;
  /** Ends the drag: the dragged tab and how far it went, or null when nothing was lifted. */
  finish(): { name: string; shift: number } | null;
}

export function createTabDrag(): TabDrag {
  let lifted: string | null = null;
  let moved = false;
  let startScroll = 0;
  let dx = 0;
  let shift = 0;
  return {
    lifted: () => lifted,
    moved: () => moved,
    lift(name, scrollX) {
      lifted = name;
      moved = false;
      startScroll = scrollX;
      dx = 0;
      shift = 0;
    },
    move(nextDx, scrollX) {
      moved = true;
      dx = nextDx;
      shift = dx + (scrollX - startScroll);
      return shift;
    },
    scrolled(scrollX) {
      shift = dx + (scrollX - startScroll);
      return shift;
    },
    shift: () => shift,
    cancelHold() {
      if (lifted === null || moved) return false;
      lifted = null;
      shift = 0;
      return true;
    },
    finish() {
      if (lifted === null) return null;
      const result = { name: lifted, shift };
      lifted = null;
      moved = false;
      dx = 0;
      shift = 0;
      return result;
    },
  };
}
