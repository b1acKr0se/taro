/**
 * A button's tooltip drawn under it (TR-229), through IconButton's `tip` (TR-128). It starts at the
 * button's left edge and is moved left to stay inside the pane the screen names with `TipBounds`.
 * Whatever draws it sits in a zIndex stack above the content below.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { createContext, useContext, useRef, useState, type ReactNode, type RefObject } from "react";
import { Text, View } from "react-native";

import { SPACE } from "./spacing";
import { tipMaxWidth, tipOffset } from "./tip-placement";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

type Measurable = { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void };

/** The pane a tooltip stays inside; with none, tooltips are not drawn. */
export const TipBounds = createContext<RefObject<unknown> | null>(null);

export function TipAnchor({ theme, text, children }: { theme: PluginTheme; text: string; children: (tip: { text: string; onShow: (open: boolean) => void }) => ReactNode }) {
  const { colors } = theme;
  const bounds = useContext(TipBounds);
  const wrapper = useRef<View>(null);
  const wanted = useRef(false);
  const [place, setPlace] = useState<{ anchorLeft: number; paneWidth: number } | null>(null);
  const onShow = (open: boolean) => {
    wanted.current = open;
    if (!open) {
      setPlace(null);
      return;
    }
    // A scroll view's ref measures like any view, though its type does not say so.
    const pane = (bounds?.current ?? null) as Measurable | null;
    if (pane === null || wrapper.current === null) return;
    pane.measureInWindow((paneX, _paneY, paneWidth) => {
      wrapper.current?.measureInWindow((x) => {
        if (wanted.current) setPlace({ anchorLeft: x - paneX, paneWidth });
      });
    });
  };
  // Every tip is a sentence or two, so it takes the widest it may and its place is known before it is drawn.
  const width = place === null ? 0 : tipMaxWidth(place.paneWidth);
  const offset = place === null ? 0 : tipOffset({ anchorLeft: place.anchorLeft, tipWidth: width, paneWidth: place.paneWidth });
  return (
    <View ref={wrapper} collapsable={false} style={{ maxWidth: "100%", zIndex: place === null ? 0 : 10 }}>
      {children({ text, onShow })}
      {place === null ? null : (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: "100%",
            left: offset,
            marginTop: SPACE.xs,
            width,
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface2,
          }}
        >
          <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) }}>{text}</Text>
        </View>
      )}
    </View>
  );
}
