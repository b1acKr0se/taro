/**
 * The line above the Manager's composer: the Catch up and Compact buttons, then its suggestions, in one
 * sideways scroll that never wraps (TR-047, TR-057). No scrollbar anywhere; while more lies past the
 * right edge, a fade and a chevron say so (TR-032).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { moreToTheRight } from "../shared/suggestions";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";

/** Strips growing opaque towards the chevron. */
const FADE_STRIPS = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
const FADE_STRIP_WIDTH = 5;

export function ActionRow({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  /** The row's scroll offset and sizes; only whether more lies past its edge is state, so scrolling re-renders nothing. */
  const row = useRef({ offset: 0, viewport: 0, content: 0 });
  const [more, setMore] = useState(false);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      content: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, paddingVertical: SPACE.xxs },
      fade: { position: "absolute" as const, top: 0, bottom: 0, right: 0, flexDirection: "row" as const },
      // The composer's own background, so the row fades into it.
      fadeEnd: { justifyContent: "center" as const, paddingRight: SPACE.xxs, backgroundColor: withAlpha(colors.surface0, 0.95) },
    }),
    [colors],
  );

  function measureRow(change: Partial<{ offset: number; viewport: number; content: number }>): void {
    row.current = { ...row.current, ...change };
    setMore(moreToTheRight(row.current.offset, row.current.viewport, row.current.content));
  }

  return (
    // Measured by plain layouts: the web's ScrollView does not report its sizes.
    <View style={{ minWidth: 0 }} onLayout={(event) => measureRow({ viewport: event.nativeEvent.layout.width })}>
      {/* False also hides the scrollbar on the web and the desktop app (react-native-web's hidden-scrollbar style). */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEventThrottle={32} onScroll={(event) => measureRow({ offset: event.nativeEvent.contentOffset.x })}>
        <View style={styles.content} onLayout={(event) => measureRow({ content: event.nativeEvent.layout.width })}>
          {children}
        </View>
      </ScrollView>
      {more ? (
        <View pointerEvents="none" style={styles.fade}>
          {FADE_STRIPS.map((alpha) => (
            <View key={alpha} style={{ width: FADE_STRIP_WIDTH, backgroundColor: withAlpha(colors.surface0, alpha) }} />
          ))}
          <View style={styles.fadeEnd}>
            <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
