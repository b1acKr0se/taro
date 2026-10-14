/**
 * A Needs you item that belongs to no ticket (TR-012): the host short of threads
 * for a while, a manager the plugin stopped recovering after repeated crashes,
 * tracker changes the plugin refused to commit and restored (TR-051), or a ticket
 * left queued with a free slot after the Manager was told (TR-062); the last two
 * the user can dismiss.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { dismissQueueAlert, dismissTrackerProtection } from "../shared/contracts";
import { queuedAlertTicket } from "../shared/queue-check";
import type { BoardAlert } from "../shared/recovery";
import { PROTECTION_ALERT_ID } from "../shared/tracker-guard";
import { useRefreshBoard } from "./board-data";
import { useRefreshProjects } from "./queries";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { Spinner } from "./ui";
import { useActions } from "./use-actions";

const HEADINGS: Readonly<Record<string, string>> = {
  headroom: "THREADS RUNNING LOW",
  "manager-crashed": "MANAGER CRASHED",
  [PROTECTION_ALERT_ID]: "TRACKER PROTECTED",
};

export function AlertCard({ project, alert, theme, compact }: { project: string; alert: BoardAlert; theme: PluginTheme; compact: boolean }) {
  const dismissProtection = useRpc(dismissTrackerProtection);
  const dismissQueued = useRpc(dismissQueueAlert);
  const queuedTicket = queuedAlertTicket(alert.id);
  const refreshBoard = useRefreshBoard(project);
  // The project list carries the Needs you badge, which counts the alert.
  const refreshProjects = useRefreshProjects();
  const presses = useActions();
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
    // The dismissed alert leaves the board, so it stays busy until it does.
    presses.press("dismiss", () => (queuedTicket === null ? dismissProtection({ project }) : dismissQueued({ project, ticket: queuedTicket })), {
      after: "hold",
      onSuccess: () => {
        refreshBoard();
        refreshProjects();
      },
    });
  }

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={styles.heading}>{queuedTicket === null ? HEADINGS[alert.id] ?? "NEEDS YOU" : "QUEUED WITH A FREE SLOT"}</Text>
        {alert.id === PROTECTION_ALERT_ID || queuedTicket !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: presses.busy, disabled: presses.busy }}
            disabled={presses.busy}
            onPress={onDismiss}
            hitSlop={8}
            style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}
          >
            {presses.busy ? <Spinner size={12} color={colors.accent} /> : null}
            <Text style={styles.dismiss}>Dismiss</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.message}>{alert.text}</Text>
    </View>
  );
}
