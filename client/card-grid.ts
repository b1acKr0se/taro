/** The narrowest a card in a grid gets before the grid drops a column: a plan card's labels and two buttons still fit (TR-105). */
export const CARD_MIN_WIDTH = 400;

/** The most cards side by side, so a row still reads as a few items rather than a table. */
export const GRID_MAX_COLUMNS = 3;

/** How many cards fit in a row of `width` with `gap` between them: one on a phone or a narrow pane, up to three on a wide one. */
export function gridColumns(width: number, gap: number): number {
  if (!(width > 0)) return 1;
  const fit = Math.floor((width + gap) / (CARD_MIN_WIDTH + gap));
  return Math.max(1, Math.min(GRID_MAX_COLUMNS, fit));
}

/** Each card's width in a row of `columns`, the gaps taken out. */
export function gridCardWidth(width: number, gap: number, columns: number): number {
  return Math.floor((width - gap * (columns - 1)) / columns);
}

/** Items cut into rows of `columns`, in order; the last row may be short. */
export function gridRows<T>(items: readonly T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += Math.max(1, columns)) rows.push(items.slice(start, start + Math.max(1, columns)));
  return rows;
}
