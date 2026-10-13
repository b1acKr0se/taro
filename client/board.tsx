/** The project's board (decisions 9, 10). Phase 1 placeholder; filled in Phase 2. */
import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";

import type { ProjectSummary } from "../shared/contracts";

export function ProjectBoard({
  summary,
  theme,
}: {
  summary: ProjectSummary;
  theme: PluginTheme;
  compact: boolean;
  onOpenAgent: ((agentId: string) => void) | null;
}) {
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>{summary.config.project}: the board arrives with the next phase.</Text>
    </View>
  );
}
