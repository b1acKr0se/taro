/**
 * A Needs you item that belongs to no ticket (TR-012): the host short of threads
 * for a while, a manager the plugin stopped recovering after repeated crashes,
 * tracker changes the plugin refused to commit and restored (TR-051), or a ticket
 * left queued with a free slot after the Manager was told (TR-062), one card for
 * all such tickets (TR-064); the last two the user can dismiss. The crashed
 * manager's card resumes it, its conversation kept (TR-072).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { alertHeading, dismissible } from "../shared/alerts";
import { dismissQueueAlert, dismissTrackerProtection, resumeManager } from "../shared/contracts";
import { MANAGER_ACTION_LABELS, MANAGER_ACTION_SUCCESS } from "../shared/manager-actions";
import { QUEUED_ALERT_ID } from "../shared/queue-check";
import type { BoardAlert } from "../shared/recovery";
import { useRefreshBoard } from "./board-data";
import { Pressable } from "./focus";
import { useRefreshProjects } from "./queries";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton, Spinner } from "./ui";
import { useActions } from "./use-actions";

export function AlertCard({ project, alert, theme, compact }: { project: string; alert: BoardAlert; theme: PluginTheme; compact: boolean }) {
  const dismissProtection = useRpc(dismissTrackerProtection);
  const dismissQueued = useRpc(dismissQueueAlert);
  const resume = useRpc(resumeManager);
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
    // The tickets this card shows are dismissed, not one that joined since the board was read.
    presses.press("dismiss", () => (alert.id === QUEUED_ALERT_ID ? dismissQueued({ project, tickets: alert.tickets }) : dismissProtection({ project })), {
      after: "hold",
      onSuccess: () => {
        refreshBoard();
        refreshProjects();
      },
    });
  }

  function onResume(): void {
    // Its failure (a reload Paseo refused) is the error toast, which names Start a fresh Manager.
    presses.press("resume", () => resume({ project }), {
      after: "hold",
      success: MANAGER_ACTION_SUCCESS.resume,
      onSuccess: () => {
        refreshBoard();
        refreshProjects();
      },
    });
  }

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={styles.heading}>{alertHeading(alert.id).toUpperCase()}</Text>
        {dismissible(alert.id) ? (
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
      {alert.id === "manager-crashed" ? (
        <View style={{ flexDirection: "row" }}>
          <IconButton
            theme={theme}
            icon="RotateCcw"
            label={MANAGER_ACTION_LABELS.resume}
            showLabel
            disabled={presses.busy}
            state={presses.stateOf("resume")}
            onPress={onResume}
          />
        </View>
      ) : null}
    </View>
  );
}
