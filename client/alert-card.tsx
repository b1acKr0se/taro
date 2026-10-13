/**
 * A Needs you item that belongs to no ticket (TR-012): the host short of threads
 * for a while, or a manager the plugin stopped recovering after repeated crashes.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";

import type { BoardAlert } from "../shared/recovery";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

const HEADINGS: Readonly<Record<string, string>> = { headroom: "THREADS RUNNING LOW", "manager-crashed": "MANAGER CRASHED" };

export function AlertCard({ alert, theme, compact }: { alert: BoardAlert; theme: PluginTheme; compact: boolean }) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      card: { borderWidth: 1, borderColor: colors.statusWarning, borderRadius: 10, padding: compact ? 10 : 12, gap: 6, backgroundColor: colors.surface1 },
      heading: { color: colors.statusWarning, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.5 },
      message: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
    }),
    [colors, compact],
  );
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{HEADINGS[alert.id] ?? "NEEDS YOU"}</Text>
      <Text style={styles.message}>{alert.text}</Text>
    </View>
  );
}
