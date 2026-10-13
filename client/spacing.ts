// One spacing scale for paddings, gaps and margins, so panes, headers and the chat keep one rhythm (TR-016).
export const SPACE = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;

/** The widest a chat's transcript and composer grow: a comfortable reading width, centred in a wider pane (TR-027). */
export const CHAT_MAX_WIDTH = 820;

/** The composer's send button and the context ring's box: one size, so the two read as a matched pair (TR-027). */
export const COMPOSER_CONTROL_SIZE = 28;
