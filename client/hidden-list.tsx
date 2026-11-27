/**
 * Hide for now (TR-293): the small eye-off button on a Needs you card, the "Hidden · N" button at the
 * column's head, and the list it opens with a Resume for each item. The host's `Modal` owns the safe
 * area and draws a sheet on a phone.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { unhideManagerQuestion, unhideTicket } from "../shared/contracts";
import { hiddenSummary, type HiddenItem } from "../shared/hidden";
import { controlColors } from "./control-colors";
import { Pressable } from "./focus";
import { errorText, relativeTime } from "./format";
import { SPACE } from "./spacing";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";
import { IconButton } from "./ui";

/** The icon-only Hide on a card's head, the size of its Dismiss, so a card does not grow taller. */
export function HideButton({ theme, label, onPress }: { theme: PluginTheme; label: string; onPress: () => void }) {
  const { colors } = theme;
  const style = useMemo(
    () => ({ width: 26, height: 26, marginVertical: -4, alignItems: "center" as const, justifyContent: "center" as const, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }),
    [colors],
  );
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={style} onPress={onPress}>
      <Icon name="EyeOff" size={14} color={colors.foregroundMuted} />
    </Pressable>
  );
}

/** "Hidden · N" at Needs you's head; nothing while nothing is hidden. `short` is the icon and the count, for a column with no room for the words. */
export function HiddenButton({ theme, count, onPress, short = false }: { theme: PluginTheme; count: number; onPress: () => void; short?: boolean }) {
  const { colors } = theme;
  const control = useMemo(() => controlColors(colors), [colors]);
  if (count === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Hidden from Needs you: ${count}, show`}
      style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xxs, borderRadius: 6, borderWidth: 1, borderColor: control.border, backgroundColor: control.fill }}
      onPress={onPress}
    >
      <Icon name="EyeOff" size={14} color={colors.foreground} />
      <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), fontWeight: "500" }}>{short ? count : `Hidden · ${count}`}</Text>
    </Pressable>
  );
}

/** The hidden items, each with when it was hidden and Resume; closes itself once the last one is back. */
export function HiddenSheet({ project, items, open, onOpenChange, onChanged, theme }: { project: string; items: readonly HiddenItem[]; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void; theme: PluginTheme }) {
  const { colors } = theme;
  const toast = useToast();
  const resumeTicket = useRpc(unhideTicket);
  const resumeQuestion = useRpc(unhideManagerQuestion);
  const [pending, setPending] = useState<string | null>(null);
  const resume = (item: HiddenItem) => {
    setPending(`${item.kind}:${item.id}`);
    const call = item.kind === "ticket" ? resumeTicket({ project, ticket: item.id }) : resumeQuestion({ project, key: item.id });
    void call
      .then(() => {
        onChanged();
        if (items.length <= 1) onOpenChange(false);
      })
      .catch((caught: unknown) => toast.error(errorText(caught)))
      .finally(() => setPending(null));
  };
  return (
    <Modal title="Hidden from Needs you" open={open} onOpenChange={onOpenChange}>
      <Modal.Content contentContainerStyle={{ padding: SPACE.lg, gap: SPACE.md }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) }}>
          {hiddenSummary()}
        </Text>
        {items.map((item) => {
          const key = `${item.kind}:${item.id}`;
          return (
            <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.md, borderTopWidth: 1, borderColor: colors.border, paddingTop: SPACE.md }}>
              <View style={{ flex: 1, minWidth: 0, gap: SPACE.xxs }}>
                <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" }}>{item.kind === "ticket" ? item.id : "The manager"}</Text>
                <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600", lineHeight: lineHeightFor(FONT_SIZE.body) }} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }}>Hidden {relativeTime(item.at)}</Text>
              </View>
              <IconButton icon="Eye" label="Resume" accessibilityLabel={`Resume ${item.kind === "ticket" ? item.id : item.title}`} showLabel theme={theme} disabled={pending !== null} state={pending === key ? "busy" : undefined} onPress={() => resume(item)} />
            </View>
          );
        })}
      </Modal.Content>
    </Modal>
  );
}
