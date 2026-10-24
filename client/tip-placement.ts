/** Where a tooltip hangs under its button (TR-229): from the button's left edge, kept inside the pane. */

/** The widest a tooltip draws, and the least it keeps from the pane's edges. */
export const TIP_MAX_WIDTH = 320;
export const TIP_MARGIN = 8;

/** The width a tooltip may take: its cap, or the pane's room where that is narrower. */
export function tipMaxWidth(paneWidth: number): number {
  return Math.max(0, Math.min(TIP_MAX_WIDTH, paneWidth - 2 * TIP_MARGIN));
}

/**
 * How far from the button's left edge the tooltip starts: 0 where it fits, negative where it would pass
 * the pane's right edge. `anchorLeft` is the button's left edge in the pane.
 */
export function tipOffset({ anchorLeft, tipWidth, paneWidth }: { anchorLeft: number; tipWidth: number; paneWidth: number }): number {
  const width = Math.min(tipWidth, tipMaxWidth(paneWidth));
  const left = Math.max(TIP_MARGIN, Math.min(anchorLeft, paneWidth - TIP_MARGIN - width));
  return left - anchorLeft;
}
