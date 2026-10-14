// One spacing scale for paddings, gaps and margins, so panes, headers and the chat keep one rhythm (TR-016).
export const SPACE = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;

/** A pane's side padding (TR-031): text keeps clear of the pane's edge and of the divider beside it. */
export function paneGutter(compact: boolean): number {
  return compact ? SPACE.lg : SPACE.xxl;
}

/** The widest a chat's transcript and composer grow: a comfortable reading width, centred in a wider pane (TR-027). */
export const CHAT_MAX_WIDTH = 820;
