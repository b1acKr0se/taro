/**
 * The last crash of an earlier launch on this device (TR-132), at the top of the Taro screen until the
 * user dismisses it: when, the error if one was caught, the last steps before it, and where the host
 * keeps the whole trail.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { dismissCrash, loadLastCrash } from "../shared/contracts";
import { crashRecorder } from "./crash-recorder";
import { crashReportText } from "./crash-report-text";
import { deviceNow } from "./crash-trail";
import { Pressable } from "./focus";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { MONOSPACE, Spinner } from "./ui";
import { useActions } from "./use-actions";

const CRASH_KEY = ["taro", "last-crash"] as const;

export function CrashCard({ theme, compact }: { theme: PluginTheme; compact: boolean }) {
  const load = useRpc(loadLastCrash);
  const dismiss = useRpc(dismissCrash);
  const client = useQueryClient();
  const presses = useActions();
  const launch = crashRecorder().launch;
  // Asked once a launch: a crash of this launch is the next one's to report.
  const crash = useQuery({ queryKey: [...CRASH_KEY, launch], queryFn: () => load({ launch, device: deviceNow() }), staleTime: Infinity });
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: colors.statusWarning,
        borderRadius: 10,
        padding: compact ? 10 : 12,
        gap: 6,
        backgroundColor: colors.surface1,
        marginHorizontal: compact ? SPACE.md : SPACE.lg,
        marginTop: SPACE.md,
      },
      heading: { color: colors.statusWarning, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.5, flex: 1 },
      muted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
      message: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
      step: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption), fontFamily: MONOSPACE },
      dismiss: { color: colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
    }),
    [colors, compact],
  );
  const report = crash.data?.crash ?? null;
  if (report === null) return null;
  const text = crashReportText(report, Date.now());

  function onDismiss(): void {
    if (report === null) return;
    presses.press("dismiss-crash", () => dismiss({ launch: report.launch }), {
      after: "hold",
      onSuccess: () => client.setQueryData([...CRASH_KEY, launch], { crash: null }),
    });
  }

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={styles.heading}>{text.heading.toUpperCase()}</Text>
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
      </View>
      <Text style={styles.muted}>{text.when}</Text>
      <Text style={styles.message} numberOfLines={6}>
        {text.cause}
      </Text>
      {text.steps.length === 0 ? null : (
        <View style={{ gap: 2 }}>
          <Text style={styles.muted}>Last steps before it:</Text>
          {text.steps.map((line, index) => (
            <Text key={index} style={styles.step} numberOfLines={1}>
              {line}
            </Text>
          ))}
        </View>
      )}
      <Text style={styles.muted} selectable>
        Full trail on the host: {text.file}
      </Text>
    </View>
  );
}
