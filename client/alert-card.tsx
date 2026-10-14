/**
 * A Needs you item that belongs to no ticket (TR-012): the host short of threads
 * for a while, a manager the plugin stopped recovering after repeated crashes,
 * or tracker changes the plugin refused to commit and restored (TR-051), which
 * the user can dismiss.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { dismissTrackerProtection } from "../shared/contracts";
import type { BoardAlert } from "../shared/recovery";
import { PROTECTION_ALERT_ID } from "../shared/tracker-guard";
import { errorText } from "./format";
import { useRefreshBoard } from "./board-data";
import { useRefreshProjects } from "./queries";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

const HEADINGS: Readonly<Record<string, string>> = {
  headroom: "THREADS RUNNING LOW",
  "manager-crashed": "MANAGER CRASHED",
  [PROTECTION_ALERT_ID]: "TRACKER PROTECTED",
};

export function AlertCard({ project, alert, theme, compact }: { project: string; alert: BoardAlert; theme: PluginTheme; compact: boolean }) {
  const toast = useToast();
  const dismiss = useRpc(dismissTrackerProtection);
  const refreshBoard = useRefreshBoard(project);
  // The project list carries the Needs you badge, which counts the alert.
  const refreshProjects = useRefreshProjects();
  const [busy, setBusy] = useState(false);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      card: { borderWidth: 1, borderColor: colors.statusWarning, borderRadius: 10, padding: compact ? 10 : 12, gap: 6, backgroundColor: colors.surface1 },
      heading: { color: colors.statusWarning, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.5, flex: 1 },
      message: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
      dismiss: { color: colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
    }),
    [colors, compact],
  );

  function onDismiss(): void {
    setBusy(true);
    dismiss({ project })
      .then(() => {
        refreshBoard();
        refreshProjects();
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setBusy(false));
  }

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={styles.heading}>{HEADINGS[alert.id] ?? "NEEDS YOU"}</Text>
        {alert.id === PROTECTION_ALERT_ID ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={onDismiss} hitSlop={8}>
            <Text style={styles.dismiss}>Dismiss</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.message}>{alert.text}</Text>
    </View>
  );
}
