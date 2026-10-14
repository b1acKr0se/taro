/**
 * Taro's text field and pressable (TR-078): every Taro file draws its fields and buttons through these,
 * so the focus rules in `focus-ring.ts` hold everywhere (`server/focus-sources.test.ts` checks it).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { TextInput as PaseoTextInput } from "@getpaseo/plugin/client/react-native";
import { createContext, forwardRef, useContext, type ComponentType } from "react";
import { Platform, Pressable as NativePressable, type PressableProps, type TextInput as NativeTextInput, type TextInputProps, type View } from "react-native";
import { FIELD_WEB_STYLE, focusRingStyle, pressableStyleWithRing } from "./focus-ring";

const FocusRingColor = createContext<string | null>(null);

/** A surface Taro registers with Paseo, giving everything inside it the theme's ring colour. */
export function withFocusRing<Props extends { theme: PluginTheme }>(Surface: ComponentType<Props>): ComponentType<Props> {
  return function FocusRingSurface(props: Props) {
    return (
      <FocusRingColor.Provider value={props.theme.colors.accent}>
        <Surface {...props} />
      </FocusRingColor.Provider>
    );
  };
}

/** The keyboard ring's colour as a style, for a pressable that is not a `Pressable` (a link in text). */
export function useFocusRing(): { outlineColor: string } | null {
  return focusRingStyle(useContext(FocusRingColor), Platform.OS === "web");
}

/** Paseo's text field, with no focus ring. */
export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TaroTextInput({ style, ...props }, ref) {
  return <PaseoTextInput ref={ref} {...props} style={Platform.OS === "web" ? [style, FIELD_WEB_STYLE] : style} />;
});

/** React Native's `Pressable`, whose keyboard ring takes the theme's accent. */
export const Pressable = forwardRef<View, PressableProps>(function TaroPressable({ style, ...props }, ref) {
  const ring = useFocusRing();
  return <NativePressable ref={ref} {...props} style={pressableStyleWithRing(style, ring)} />;
});
