/**
 * The agents of one ticket as chips above its chat (TR-016): each names its job and task, and under
 * that whether it runs, its model and how long it has run — from Paseo's status, never its words.
 * On a phone (`slim`) each is one short line — its state dot and job — so the strip stays one row (TR-031).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { ScrollView, Text, View } from "react-native";

import { CentredLabel } from "./centred-label";
import { controlColors } from "./control-colors";
import { Pressable } from "./focus";
import { paneAgentDetail, paneAgentState, roleIcon, type PaneAgent, type PaneAgentState } from "./pane-agents";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, labelLineHeightFor } from "./type-scale";

function stateColor(theme: PluginTheme, state: PaneAgentState): string {
  if (state === "running") return theme.colors.statusSuccess;
  if (state === "error") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

export function AgentChips({
  theme,
  agents,
  selectedId,
  now,
  onSelect,
  slim = false,
}: {
  theme: PluginTheme;
  slim?: boolean;
  agents: readonly PaneAgent[];
  selectedId: string | null;
  now: number;
  onSelect: (agentId: string) => void;
}) {
  const { colors } = theme;
  const control = controlColors(colors);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm }}>
      {agents.map((agent) => {
        const selected = agent.id === selectedId;
        const { state } = paneAgentState(agent, now);
        const color = stateColor(theme, state);
        // A filled dot while it runs, a hollow one while it is idle or stopped.
        const mark =
          state === "done" ? (
            <Icon name="CircleCheck" size={11} color={color} />
          ) : (
            <View style={{ width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: color, backgroundColor: state === "running" ? color : "transparent" }} />
          );
        if (slim) {
          return (
            <Pressable
              key={agent.id}
              accessibilityRole="button"
              accessibilityLabel={`${agent.label}, ${paneAgentDetail(agent, now)}`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(agent.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: SPACE.xs + SPACE.xxs,
                paddingHorizontal: SPACE.sm,
                paddingVertical: SPACE.xxs + 1,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: selected ? control.accentBorder : control.border,
                backgroundColor: selected ? withAlpha(colors.accent, 0.12) : control.fill,
              }}
            >
              {mark}
              <CentredLabel style={{ color: selected ? colors.foreground : colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), fontWeight: "600", maxWidth: 180 }} numberOfLines={1}>
                {agent.label}
              </CentredLabel>
            </Pressable>
          );
        }
        return (
          <Pressable
            key={agent.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(agent.id)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: SPACE.sm,
              paddingHorizontal: SPACE.md,
              paddingVertical: SPACE.xs + SPACE.xxs,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: selected ? control.accentBorder : control.border,
              backgroundColor: selected ? withAlpha(colors.accent, 0.12) : control.fill,
            }}
          >
            <Icon name={roleIcon(agent)} size={14} color={selected ? colors.accent : colors.foregroundMuted} />
            <View style={{ gap: SPACE.xxs, maxWidth: 280 }}>
              <CentredLabel style={{ color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: labelLineHeightFor(FONT_SIZE.small), fontWeight: "600" }} numberOfLines={1}>
                {agent.label}
              </CentredLabel>
              <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
                {mark}
                <Text style={{ color: state === "running" ? color : colors.foregroundMuted, fontSize: FONT_SIZE.caption }} numberOfLines={1}>
                  {paneAgentDetail(agent, now)}
                </Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
