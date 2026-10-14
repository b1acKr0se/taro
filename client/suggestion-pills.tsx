/**
 * The Manager's suggestions, above its composer where the user talks to it (TR-045): chips shaped like
 * the Catch up and Compact buttons (TR-070), after them, scrolling sideways with them in one row (`ActionRow`, TR-057).
 * Each pill sends itself to the Manager when tapped and shows sending, sent or not sent inside it;
 * its × dismisses it.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { dismissSuggestion, tellManager } from "../shared/contracts";
import { suggestionKey, suggestionPills, type SendState, type Suggestion, type SuggestionPill, type SuggestionSend } from "../shared/suggestions";
import { errorText } from "./format";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { BUTTON } from "./control-size";
import { Spinner } from "./ui";
import { usePressGuards } from "./use-actions";

/** How long a sent suggestion shows "Sent to the Manager" before it leaves the row. */
const SENT_VISIBLE_MS = 2500;

export function SuggestionPills({
  project,
  suggestions: current,
  theme,
  onChanged,
}: {
  project: string;
  suggestions: readonly Suggestion[];
  theme: PluginTheme;
  /** Reloads the board, which carries the suggestions. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const tell = useRpc(tellManager);
  const dismiss = useRpc(dismissSuggestion);
  const guardFor = usePressGuards();
  const [sends, setSends] = useState<SuggestionSend[]>([]);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      // Catch up's shape and measurements (`BUTTON`, TR-070): the send part and the × share its padding.
      suggestion: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        minHeight: BUTTON.height,
        borderWidth: BUTTON.borderWidth,
        borderColor: colors.border,
        borderRadius: BUTTON.borderRadius,
        backgroundColor: colors.surface1,
      },
      suggestionSend: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: BUTTON.gap,
        paddingLeft: BUTTON.paddingHorizontal,
        paddingRight: BUTTON.gap,
        paddingVertical: BUTTON.paddingVertical,
      },
      suggestionText: { color: colors.foreground, fontSize: BUTTON.fontSize, lineHeight: BUTTON.lineHeight, fontWeight: "500" as const },
      suggestionState: { fontSize: BUTTON.fontSize, lineHeight: BUTTON.lineHeight, fontWeight: "500" as const },
      suggestionDismiss: { paddingLeft: SPACE.xxs, paddingRight: BUTTON.paddingHorizontal, paddingVertical: BUTTON.paddingVertical },
    }),
    [colors],
  );
  const suggestions = suggestionPills(current, sends);
  if (suggestions.length === 0) return null;

  /** Records one suggestion's send state; `null` forgets it. */
  function setSend(suggestion: Suggestion, index: number, state: SendState | null, reason?: string): void {
    const key = suggestionKey(suggestion);
    const kept = state === null ? [] : [reason === undefined ? { suggestion, state, index } : { suggestion, state, index, reason }];
    setSends((current) => [...current.filter((send) => suggestionKey(send.suggestion) !== key), ...kept]);
  }

  /** Sends it, shows "Sent" for a moment and hides it for good (the manager may write it again); a failure stays to retry. */
  function sendSuggestion(suggestion: Suggestion, index: number): void {
    // Released once sent: from then the pill's own Sent state disables it until it leaves, or comes back if the dismiss failed.
    const running = guardFor(suggestionKey(suggestion)).run("send", () => tell({ project, text: suggestion.prompt }));
    if (running === null) return;
    setSend(suggestion, index, "sending");
    void running.then((outcome) => {
      if (outcome.ok) {
        setSend(suggestion, index, "sent");
        dismiss({ project, label: suggestion.label, prompt: suggestion.prompt }).catch((caught: unknown) => toast.error(errorText(caught)));
        setTimeout(() => {
          setSend(suggestion, index, null);
          onChanged();
        }, SENT_VISIBLE_MS);
      } else {
        const reason = errorText(outcome.error);
        setSend(suggestion, index, "failed", reason);
        toast.error(`Not sent to the Manager: ${reason}`);
      }
    });
  }

  function dismissPill(suggestion: Suggestion): void {
    // The same guard as its send: a pill cannot be dismissed while it is being sent, nor twice.
    const running = guardFor(suggestionKey(suggestion)).run("dismiss", () => dismiss({ project, label: suggestion.label, prompt: suggestion.prompt }), "hold");
    void running?.then((outcome) => {
      if (outcome.ok) onChanged();
      else toast.error(errorText(outcome.error));
    });
  }

  function suggestionPill(item: SuggestionPill, index: number) {
    const { suggestion, state, reason } = item;
    const busy = state === "sending" || state === "sent";
    const label =
      state === "sending"
        ? `Sending to the Manager: ${suggestion.label}`
        : state === "sent"
          ? `Sent to the Manager: ${suggestion.label}`
          : state === "failed"
            ? `Not sent to the Manager${reason === undefined ? "" : ` (${reason})`}, tap to retry: ${suggestion.label}`
            : `Send to the Manager: ${suggestion.label}`;
    return (
      <View
        key={suggestionKey(suggestion)}
        style={[styles.suggestion, state === "failed" ? { borderColor: withAlpha(colors.statusDanger, 0.6) } : state === "sent" ? { borderColor: withAlpha(colors.statusSuccess, 0.6) } : null]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy, disabled: busy }} disabled={busy} style={styles.suggestionSend} onPress={() => sendSuggestion(suggestion, index)}>
          <Text style={[styles.suggestionText, busy ? { color: colors.foregroundMuted } : null]} numberOfLines={1}>
            {suggestion.label}
          </Text>
          {state === "sending" ? (
            <>
              <Spinner size={BUTTON.iconSize} color={colors.foregroundMuted} />
              <Text style={[styles.suggestionState, { color: colors.foregroundMuted }]}>Sending…</Text>
            </>
          ) : state === "sent" ? (
            <>
              <Icon name="Check" size={BUTTON.iconSize} color={colors.statusSuccess} />
              <Text style={[styles.suggestionState, { color: colors.statusSuccess }]}>Sent to the Manager</Text>
            </>
          ) : state === "failed" ? (
            <>
              <Icon name="RotateCw" size={BUTTON.iconSize} color={colors.statusDanger} />
              <Text style={[styles.suggestionState, { color: colors.statusDanger }]}>Not sent · Retry</Text>
            </>
          ) : (
            <Icon name="Send" size={BUTTON.iconSize} color={colors.accent} />
          )}
        </Pressable>
        {busy ? (
          <View style={{ width: BUTTON.paddingHorizontal - BUTTON.gap }} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${suggestion.label}`}
            hitSlop={6}
            style={styles.suggestionDismiss}
            onPress={() => dismissPill(suggestion)}
          >
            <Icon name="X" size={BUTTON.iconSize} color={colors.foregroundMuted} />
          </Pressable>
        )}
      </View>
    );
  }

  return <>{suggestions.map(suggestionPill)}</>;
}
