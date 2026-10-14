/** The "Before you start" lines (spec §6). */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";

import { checkPrerequisites, type Prerequisite } from "../shared/contracts";
import { CheckLine } from "./settings-form";
import { SPACE } from "./spacing";

const PREREQUISITES_KEY = ["taro", "prerequisites"] as const;

export function usePrerequisites() {
  const prerequisitesRpc = useRpc(checkPrerequisites);
  return useQuery({ queryKey: PREREQUISITES_KEY, queryFn: () => prerequisitesRpc({}) });
}

export function PrerequisiteList({ theme, checks }: { theme: PluginTheme; checks: readonly Prerequisite[] }) {
  return (
    <View style={{ gap: SPACE.sm }}>
      {checks.map((check) => (
        <CheckLine key={check.id} theme={theme} ok={check.ok} name={check.name} detail={check.detail} />
      ))}
    </View>
  );
}
