/**
 * The agents of one ticket as chips above its chat (TR-016): each names its job and task, and under
 * that whether it runs, its model and how long it has run — from Paseo's status, never its words.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, ScrollView, Text, View } from "react-native";

import { paneAgentDetail, paneAgentState, roleIcon, type PaneAgent, type PaneAgentState } from "./pane-agents";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE } from "./type-scale";

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
}: {
  theme: PluginTheme;
  agents: readonly PaneAgent[];
  selectedId: string | null;
  now: number;
  onSelect: (agentId: string) => void;
}) {
  const { colors } = theme;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm }}>
      {agents.map((agent) => {
        const selected = agent.id === selectedId;
        const { state } = paneAgentState(agent, now);
        const color = stateColor(theme, state);
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
              borderColor: selected ? colors.accent : colors.border,
              backgroundColor: selected ? withAlpha(colors.accent, 0.12) : colors.surface1,
            }}
          >
            <Icon name={roleIcon(agent)} size={14} color={selected ? colors.accent : colors.foregroundMuted} />
            <View style={{ gap: SPACE.xxs, maxWidth: 280 }}>
              <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "600" }} numberOfLines={1}>
                {agent.label}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
                {state === "done" ? (
                  <Icon name="CircleCheck" size={11} color={color} />
                ) : (
                  // A filled dot while it runs, a hollow one while it is idle or stopped.
                  <View style={{ width: 7, height: 7, borderRadius: 4, borderWidth: 1.5, borderColor: color, backgroundColor: state === "running" ? color : "transparent" }} />
                )}
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
