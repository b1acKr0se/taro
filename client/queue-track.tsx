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
import { Pressable } from "./focus";
import { polled } from "./polling";
import { chatQueueKey, QUEUE_POLL_BUSY_MS, queuePollMs, queueRowActions, queueRowText, type QueueRowAction, type QueueRowMessage } from "./queue-rows";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { Spinner } from "./ui";

const NO_MESSAGES: readonly QueueRowMessage[] = [];

/** The agent's queued messages, oldest first; read every 2 s while there are some or the agent works. Not read for a chat with no composer. */
export function useChatQueue(agentId: string, working: boolean, enabled: boolean): readonly QueueRowMessage[] {
  const list = useRpc(listChatQueue);
  const query = useQuery({
    queryKey: chatQueueKey(agentId),
    queryFn: () => list({ agentId }),
    enabled,
    // Fresh for one short poll only: a chat opened again must not show a row the daemon sent meanwhile.
    ...polled(QUEUE_POLL_BUSY_MS),
    // The interval follows the last read: often while a row waits to leave.
    refetchInterval: (current) => queuePollMs({ queued: current.state.data?.messages.length ?? 0, working }),
  });
  return enabled ? (query.data?.messages ?? NO_MESSAGES) : NO_MESSAGES;
}

/** Paseo's queue button: 32 px, round, never shrunk by a long message beside it. */
const BUTTON_SIZE = 32;

export function QueueTrack({
  messages,
  compacting,
  busy,
  theme,
  onAction,
}: {
  messages: readonly QueueRowMessage[];
  /** The agent compacts: no Send now, which the daemon would refuse. */
  compacting: boolean;
  /** The row whose action is under way, which takes no other press meanwhile. */
  busy: { id: string; action: QueueRowAction } | null;
  theme: PluginTheme;
  onAction: (message: QueueRowMessage, action: QueueRowAction) => void;
}) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
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
    }),
    [colors],
  );
  if (messages.length === 0) return null;
  return (
    <View style={styles.track}>
      {messages.map((message) => {
        const text = queueRowText(message);
        const rowBusy = busy?.id === message.id;
        return (
          <View key={message.id} style={styles.row}>
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
              {queueRowActions(message, compacting).map((button) => {
                const tint = button.accent ? colors.accentForeground : colors.foreground;
                return (
                  <Pressable
                    key={button.action}
                    accessibilityRole="button"
                    accessibilityLabel={button.label}
                    accessibilityState={{ disabled: rowBusy, busy: rowBusy && busy?.action === button.action }}
                    disabled={rowBusy}
                    onPress={() => onAction(message, button.action)}
                    style={[styles.button, button.accent ? styles.accent : null]}
                  >
                    {rowBusy && busy?.action === button.action ? <Spinner size={14} color={tint} /> : <Icon name={button.icon} size={14} color={tint} />}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}
