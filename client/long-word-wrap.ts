/**
 * Lets a word longer than its line (a URL) break across lines, so a message stays inside its box
 * (TR-198). The web's `overflow-wrap: break-word` does not lower an element's minimum width, so a
 * right-aligned bubble grew leftwards past the pane and cut off the start of every line; `anywhere`
 * does. React Native's types do not list the property, and the phone wraps long words itself.
 */
export const BREAK_LONG_WORDS = { overflowWrap: "anywhere" } as object;
