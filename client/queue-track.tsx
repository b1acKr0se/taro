/**
 * The chat queue above the composer (TR-171), drawn as Paseo's own: one row per message waiting on the
 * daemon for the agent's turn to end, oldest on top, with Edit and Send now (or Retry, for one whose
 * send failed). The queue is the daemon's, read with `taro.queue.list`, so it shows the same after the
 * app is reopened and a row leaves once the daemon sent it.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { listChatQueue } from "../shared/contracts";
import { useDelayedFlag } from "./delayed-flag";
import { Pressable } from "./focus";
import { polled } from "./polling";
import { chatQueueKey, QUEUE_POLL_BUSY_MS, queuePollMs, queueRowActions, queueRowText, RETRYING_ACTIONS, type QueueRowAction, type QueueRowMessage, type TrackRow } from "./queue-rows";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { Spinner } from "./ui";

const NO_MESSAGES: readonly QueueRowMessage[] = [];

export interface ChatQueueView {
  messages: readonly QueueRowMessage[];
  /** Taro compacts the agent: the daemon refuses Send now. */
  compacting: boolean;
  /** When (client ms) the request of the read shown began, null before one: a row may leave only on a read begun after it changed. */
  readStartedAt: number | null;
  /** When (client ms) that read answered, null before one. */
  readAnsweredAt: number | null;
}

/** The agent's queued messages, oldest first; read every 2 s while there are some or the agent works. Not read for a chat with no composer. */
export function useChatQueue(agentId: string, working: boolean, enabled: boolean): ChatQueueView {
  const list = useRpc(listChatQueue);
  const query = useQuery({
    queryKey: chatQueueKey(agentId),
    queryFn: async () => {
      const startedAt = Date.now();
      const listing = await list({ agentId });
      return { ...listing, startedAt, answeredAt: Date.now() };
    },
    enabled,
    // Fresh for one short poll only: a chat opened again must not show a row the daemon sent meanwhile.
    ...polled(QUEUE_POLL_BUSY_MS),
    // The interval follows the last read: often while a row waits to leave.
    refetchInterval: (current) => queuePollMs({ queued: current.state.data?.messages.length ?? 0, working }),
  });
  const messages = enabled ? (query.data?.messages ?? NO_MESSAGES) : NO_MESSAGES;
  const compacting = enabled && query.data?.compacting === true;
  const readStartedAt = enabled ? (query.data?.startedAt ?? null) : null;
  const readAnsweredAt = enabled ? (query.data?.answeredAt ?? null) : null;
  return useMemo(() => ({ messages, compacting, readStartedAt, readAnsweredAt }), [messages, compacting, readStartedAt, readAnsweredAt]);
}

/** Paseo's queue button: 32 px, round, never shrunk by a long message beside it. */
const BUTTON_SIZE = 32;

function trackStyles(colors: PluginTheme["colors"]) {
  return {
    track: { flexDirection: "column" as const, gap: SPACE.sm },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: SPACE.md,
      paddingVertical: SPACE.sm,
      backgroundColor: colors.surface1,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      gap: SPACE.sm,
    },
    words: { flex: 1, minWidth: 0, gap: 2 },
    text: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
    attachments: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
    failed: { color: colors.statusDanger, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
    actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm, flexShrink: 0 },
    button: { width: BUTTON_SIZE, height: BUTTON_SIZE, borderRadius: BUTTON_SIZE / 2, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: colors.surface2 },
    accent: { backgroundColor: colors.accent },
  };
}

type TrackStyles = ReturnType<typeof trackStyles>;

/**
 * The queue's rows, one per message under its own id from the moment it is sent until the transcript
 * shows it: this app's own are drawn finished at once, with their buttons, before the daemon answers.
 */
export function QueueTrack({
  rows,
  busy,
  compacting,
  theme,
  onAction,
}: {
  rows: readonly TrackRow[];
  /** Each row whose action is under way: that row takes no other press meanwhile, the others do. */
  busy: ReadonlyMap<string, QueueRowAction>;
  /** The agent compacts: no Send now, which the daemon would refuse. */
  compacting: boolean;
  theme: PluginTheme;
  onAction: (message: QueueRowMessage, action: QueueRowAction) => void;
}) {
  const { colors } = theme;
  const styles = useMemo(() => trackStyles(colors), [colors]);
  if (rows.length === 0) return null;
  return (
    <View style={styles.track}>
      {rows.map((row) => (
        <QueueRow key={row.message.id} row={row} busy={busy.get(row.message.id) ?? null} compacting={compacting} theme={theme} styles={styles} onAction={onAction} />
      ))}
    </View>
  );
}

function QueueRow({
  row,
  busy,
  compacting,
  theme,
  styles,
  onAction,
}: {
  row: TrackRow;
  busy: QueueRowAction | null;
  compacting: boolean;
  theme: PluginTheme;
  styles: TrackStyles;
  onAction: (message: QueueRowMessage, action: QueueRowAction) => void;
}) {
  const { colors } = theme;
  const { message, retrying } = row;
  const text = queueRowText(message);
  // A retried row waits on its Retry: Edit held, Retry busy.
  const underWay: QueueRowAction | null = retrying ? "retry" : busy;
  const buttons = retrying ? RETRYING_ACTIONS : queueRowActions(message, compacting);
  // The buttons hold at once; the spinner only once the wait has lasted a moment, so a quick answer shows none.
  const spinnerShown = useDelayedFlag(underWay !== null);
  return (
    <View style={styles.row}>
      <View style={styles.words}>
        {text.words === null ? null : (
          <Text style={styles.text} numberOfLines={2} ellipsizeMode="tail">
            {text.words}
          </Text>
        )}
        {text.attachments === null ? null : (
          <Text style={styles.attachments} numberOfLines={1}>
            {text.attachments}
          </Text>
        )}
        {text.failed === null ? null : <Text style={styles.failed}>{text.failed}</Text>}
      </View>
      <View style={styles.actions}>
        {buttons.map((button) => {
          const tint = button.accent ? colors.accentForeground : colors.foreground;
          const spinning = spinnerShown && underWay === button.action;
          return (
            <Pressable
              key={button.action}
              accessibilityRole="button"
              accessibilityLabel={button.label}
              accessibilityState={{ disabled: underWay !== null, busy: spinning }}
              disabled={underWay !== null}
              onPress={() => onAction(message, button.action)}
              style={[styles.button, button.accent ? styles.accent : null]}
            >
              {spinning ? <Spinner size={14} color={tint} /> : <Icon name={button.icon} size={14} color={tint} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
