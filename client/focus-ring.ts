/**
 * Focus on the desktop and in the browser (TR-078). Paseo's web page rings every focused element with
 * `*:focus-visible { outline: 2px solid #20744a }`, its default green, whatever the theme: a theme with
 * another accent got a green ring. A text field always matches `:focus-visible`, so it showed the ring on
 * every click. Taro's fields show no focus cue (the caret is enough), and its buttons keep the ring for
 * the keyboard alone (`:focus-visible`), drawn in the theme's accent. A style set on the element wins over
 * the page's rule.
 */
import type { PressableProps, PressableStateCallbackType } from "react-native";

/** A text field's style on the web: no outline, so a focused field looks as it does unfocused. */
export const FIELD_WEB_STYLE = { outlineWidth: 0 } as const;

/** What a pressable's keyboard ring is drawn in, or null to leave the page's own. */
export function focusRingStyle(color: string | null, web: boolean): { outlineColor: string } | null {
  return web && color !== null ? { outlineColor: color } : null;
}

/**
 * A `Pressable` style with the ring's colour after it; a style written as a function of the press state
 * stays one.
 */
export function pressableStyleWithRing(style: PressableProps["style"], ring: { outlineColor: string } | null): PressableProps["style"] {
  if (ring === null) return style;
  if (typeof style === "function") return (state: PressableStateCallbackType) => [style(state), ring];
  return [style, ring];
}
