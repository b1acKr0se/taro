/**
 * The Manager's suggestions, above its composer where the user talks to it (TR-045): the rest of the
 * line after the Catch up and Compact buttons (TR-047), scrolling sideways and never wrapping, fading
 * at the edge while more lie past it (TR-032).
 * Each pill sends itself to the Manager when tapped and shows sending, sent or not sent inside it;
 * its × dismisses it.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { dismissSuggestion, tellManager } from "../shared/contracts";
import { moreToTheRight, suggestionKey, suggestionPills, type SendState, type Suggestion, type SuggestionPill, type SuggestionSend } from "../shared/suggestions";
import { errorText } from "./format";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE } from "./type-scale";
import { Spinner } from "./ui";

/** How long a sent suggestion shows "Sent to the Manager" before it leaves the row. */
const SENT_VISIBLE_MS = 2500;
/** The fade at the row's right edge while more pills lie past it: strips growing opaque towards a chevron. */
const FADE_STRIPS = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
const FADE_STRIP_WIDTH = 5;

export function SuggestionRow({
  project,
  suggestions: current,
  theme,
  compact,
  onChanged,
}: {
  project: string;
  suggestions: readonly Suggestion[];
  theme: PluginTheme;
  compact: boolean;
  /** Reloads the board, which carries the suggestions. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const tell = useRpc(tellManager);
  const dismiss = useRpc(dismissSuggestion);
  const [sends, setSends] = useState<SuggestionSend[]>([]);
  /** The row's scroll offset and sizes; only whether more lies past its edge is state, so scrolling re-renders nothing. */
  const row = useRef({ offset: 0, viewport: 0, content: 0 });
  const [more, setMore] = useState(false);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      frame: { flex: 1, minWidth: 0, flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.xs },
      bulb: { paddingRight: SPACE.xxs },
      fade: { position: "absolute" as const, top: 0, bottom: 0, right: 0, flexDirection: "row" as const },
      // The composer's own background, so the pills fade into it.
      fadeEnd: { justifyContent: "center" as const, paddingRight: SPACE.xxs, backgroundColor: withAlpha(colors.surface0, 0.95) },
      suggestions: { flexDirection: "row" as const, gap: SPACE.xs + 2, paddingVertical: SPACE.xxs },
      suggestion: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 999,
        backgroundColor: colors.surface1,
      },
      suggestionSend: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.xs + 2, paddingLeft: SPACE.sm + 2, paddingRight: SPACE.xs, paddingVertical: SPACE.xs },
      suggestionText: { color: colors.foreground, fontSize: FONT_SIZE.caption, fontWeight: "500" as const },
      suggestionState: { fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      suggestionDismiss: { paddingLeft: SPACE.xxs, paddingRight: SPACE.sm, paddingVertical: SPACE.xs },
    }),
    [colors],
  );
  const suggestions = suggestionPills(current, sends);
  if (suggestions.length === 0) return null;

  function measureRow(change: Partial<{ offset: number; viewport: number; content: number }>): void {
    row.current = { ...row.current, ...change };
    setMore(moreToTheRight(row.current.offset, row.current.viewport, row.current.content));
  }

  /** Records one suggestion's send state; `null` forgets it. */
  function setSend(suggestion: Suggestion, index: number, state: SendState | null, reason?: string): void {
    const key = suggestionKey(suggestion);
    const kept = state === null ? [] : [reason === undefined ? { suggestion, state, index } : { suggestion, state, index, reason }];
    setSends((current) => [...current.filter((send) => suggestionKey(send.suggestion) !== key), ...kept]);
  }

  /** Sends it, shows "Sent" for a moment and hides it for good (the manager may write it again); a failure stays to retry. */
  function sendSuggestion(suggestion: Suggestion, index: number): void {
    setSend(suggestion, index, "sending");
    tell({ project, text: suggestion.prompt }).then(
      () => {
        setSend(suggestion, index, "sent");
        dismiss({ project, label: suggestion.label, prompt: suggestion.prompt }).catch((caught: unknown) => toast.error(errorText(caught)));
        setTimeout(() => {
          setSend(suggestion, index, null);
          onChanged();
        }, SENT_VISIBLE_MS);
      },
      (caught: unknown) => {
        const reason = errorText(caught);
        setSend(suggestion, index, "failed", reason);
        toast.error(`Not sent to the Manager: ${reason}`);
      },
    );
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
              <Spinner size={13} color={colors.foregroundMuted} />
              <Text style={[styles.suggestionState, { color: colors.foregroundMuted }]}>Sending…</Text>
            </>
          ) : state === "sent" ? (
            <>
              <Icon name="Check" size={13} color={colors.statusSuccess} />
              <Text style={[styles.suggestionState, { color: colors.statusSuccess }]}>Sent to the Manager</Text>
            </>
          ) : state === "failed" ? (
            <>
              <Icon name="RotateCw" size={13} color={colors.statusDanger} />
              <Text style={[styles.suggestionState, { color: colors.statusDanger }]}>Not sent · Retry</Text>
            </>
          ) : (
            <Icon name="Send" size={13} color={colors.accent} />
          )}
        </Pressable>
        {busy ? (
          <View style={{ width: SPACE.sm }} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${suggestion.label}`}
            hitSlop={6}
            style={styles.suggestionDismiss}
            onPress={() => void dismiss({ project, label: suggestion.label, prompt: suggestion.prompt }).then(onChanged).catch((caught: unknown) => toast.error(errorText(caught)))}
          >
            <Icon name="X" size={12} color={colors.foregroundMuted} />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <View style={styles.bulb} accessibilityLabel="Suggested next">
        <Icon name="Lightbulb" size={13} color={colors.foregroundMuted} />
      </View>
      {/* Measured by plain layouts: the web's ScrollView does not report its sizes. */}
      <View style={{ flex: 1, minWidth: 0 }} onLayout={(event) => measureRow({ viewport: event.nativeEvent.layout.width })}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={!compact}
          scrollEventThrottle={32}
          onScroll={(event) => measureRow({ offset: event.nativeEvent.contentOffset.x })}
        >
          <View style={styles.suggestions} onLayout={(event) => measureRow({ content: event.nativeEvent.layout.width })}>
            {suggestions.map(suggestionPill)}
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
    </View>
  );
}
