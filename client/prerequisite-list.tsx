/**
 * The "Before you start" lines (spec §6), and Taro's own Backlog.md install on a missing one
 * (TR-063): Install starts it on the daemon, the line polls its progress, and the checks run again
 * once it is done, so the line turns green without a reload.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Text, View } from "react-native";

import { backlogInstallStatus, checkPrerequisites, installBacklog, type BacklogInstall, type Prerequisite } from "../shared/contracts";
import { CheckLine } from "./settings-form";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton, Spinner } from "./ui";
import { useActions } from "./use-actions";

const PREREQUISITES_KEY = ["taro", "prerequisites"] as const;
const INSTALL_KEY = ["taro", "backlog-install"] as const;
const INSTALL_POLL_MS = 1000;

export function usePrerequisites() {
  const prerequisitesRpc = useRpc(checkPrerequisites);
  return useQuery({ queryKey: PREREQUISITES_KEY, queryFn: () => prerequisitesRpc({}) });
}

export function PrerequisiteList({ theme, checks }: { theme: PluginTheme; checks: readonly Prerequisite[] }) {
  return (
    <View style={{ gap: SPACE.sm }}>
      {checks.map((check) => (
        <CheckLine key={check.id} theme={theme} ok={check.ok} name={check.name} detail={check.detail}>
          {check.fix === "install-backlog" ? <BacklogInstallAction theme={theme} /> : null}
        </CheckLine>
      ))}
    </View>
  );
}

function BacklogInstallAction({ theme }: { theme: PluginTheme }) {
  const start = useRpc(installBacklog);
  const statusRpc = useRpc(backlogInstallStatus);
  const queryClient = useQueryClient();
  const presses = useActions();
  // Read once on open too: an install started from another page, or before a reconnect, carries on.
  const status = useQuery({
    queryKey: INSTALL_KEY,
    queryFn: async (): Promise<BacklogInstall> => (await statusRpc({})).install,
    refetchInterval: (query) => (query.state.data?.phase === "running" ? INSTALL_POLL_MS : false),
  });
  const install = status.data ?? null;
  const running = install?.phase === "running";

  useEffect(() => {
    if (install?.phase === "done") void queryClient.invalidateQueries({ queryKey: PREREQUISITES_KEY });
  }, [install?.phase]);

  const colors = theme.colors;
  const small = { fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) };
  return (
    <View style={{ gap: SPACE.sm, alignItems: "flex-start" }}>
      {running ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm }}>
          <Spinner size={14} color={colors.accent} />
          <Text style={[small, { color: colors.foreground }]}>{install.step ?? "Installing…"}</Text>
        </View>
      ) : install?.phase === "done" ? (
        <Text style={[small, { color: colors.foreground }]}>{`Installed backlog ${install.version ?? ""}. Checking again…`}</Text>
      ) : (
        <IconButton
          theme={theme}
          tone="accent"
          icon="Download"
          label={install?.phase === "failed" ? "Try again" : "Install Backlog.md"}
          showLabel
          disabled={presses.busy}
          state={presses.stateOf("install")}
          onPress={() =>
            presses.press("install", async () => {
              const result = await start({});
              queryClient.setQueryData(INSTALL_KEY, result.install);
            })
          }
        />
      )}
      {install?.phase === "failed" && install.error !== null ? <Text selectable style={[small, { color: colors.statusDanger }]}>{install.error}</Text> : null}
    </View>
  );
}
