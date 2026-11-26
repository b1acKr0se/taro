/**
 * "Is this a brand new project?", drawn in the manager's place (the left pane, or the Manager tab
 * on a phone) while an empty project has no choice stored; its words and moves are in
 * `project-start.ts`. A press stores the answer; the refreshed project list then shows the
 * manager's chat.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { chooseProjectStart } from "../shared/contracts";
import type { ProjectStart } from "../shared/project";
import { Pressable } from "./focus";
import { keptMap } from "./kept";
import { errorText } from "./format";
import { START_CHOICES, START_SUBTITLE, START_TITLE, startInput, startNotice } from "./project-start";
import { useRefreshProjects } from "./queries";
import { paneGutter, SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

/**
 * The line a press left for the manager's pane, by project: kept across the screen's remounts until
 * dismissed (a reload may drop it; the summary's pending fact still covers a manager not running).
 */
export const startNotices = keptMap<string, string>(globalThis, "start-notices.v1");

export function StartQuestion({ project, theme, compact, onChosen }: { project: string; theme: PluginTheme; compact: boolean; onChosen: () => void }) {
  const choose = useRpc(chooseProjectStart);
  const refreshProjects = useRefreshProjects();
  const [sending, setSending] = useState<ProjectStart | null>(null);
  const [error, setError] = useState<string | null>(null);

  function press(choice: ProjectStart): void {
    if (sending !== null) return;
    setSending(choice);
    setError(null);
    choose(startInput(project, choice))
      .then((answer) => {
        const notice = startNotice(choice, answer);
        if (notice === null) startNotices.delete(project);
        else startNotices.set(project, notice);
        refreshProjects();
        onChosen();
      })
      .catch((failure: unknown) => setError(errorText(failure)))
      .finally(() => setSending(null));
  }

  const titleSize = compact ? FONT_SIZE.heading : FONT_SIZE.display;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: paneGutter(compact), paddingTop: SPACE.xxl }}>
      <View style={{ maxWidth: 520, gap: SPACE.md }}>
        <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: titleSize, lineHeight: lineHeightFor(titleSize), fontWeight: "600" }}>
          {START_TITLE}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) }}>{START_SUBTITLE}</Text>
        <View style={{ gap: SPACE.sm, marginTop: SPACE.xs }}>
          {START_CHOICES.map((option) => (
            <Pressable
              key={option.choice}
              accessibilityRole="button"
              accessibilityLabel={option.title}
              accessibilityHint={option.description}
              accessibilityState={{ disabled: sending !== null, busy: sending === option.choice }}
              disabled={sending !== null}
              onPress={() => press(option.choice)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: SPACE.md,
                padding: SPACE.lg,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface1,
                opacity: sending !== null && sending !== option.choice ? 0.5 : 1,
              })}
            >
              <View style={{ flex: 1, gap: SPACE.xs }}>
                <Text style={{ color: theme.colors.foreground, fontSize: FONT_SIZE.subtitle, lineHeight: lineHeightFor(FONT_SIZE.subtitle), fontWeight: "600" }}>{option.title}</Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) }}>{option.description}</Text>
              </View>
              {sending === option.choice ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> : null}
            </Pressable>
          ))}
        </View>
        {error === null ? null : (
          <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) }}>
            {error}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}
