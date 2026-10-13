/**
 * The Taro screen (decision 8): a tab per project plus "＋ project". A project
 * shows its manager's conversation beside its board; on a phone the two are
 * tabs (decision 12). Params: `project`, `view` ("setup" | "settings").
 */
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { catchUp, compactManager, tellManager, type ProjectSummary } from "../shared/contracts";
import { AgentChat } from "./agent-chat";
import { ContextMeter } from "./context-meter";
import { errorText } from "./format";
import { ProjectSetup } from "./project-setup";
import { useProjects, useRefreshProjects } from "./queries";
import { FONT_SIZE } from "./type-scale";
import { IconButton, Segmented } from "./ui";
import { ProjectBoard } from "./board";

/** What the screen shows, kept across remounts (the host unmounts a screen whenever the user navigates away). */
const remembered: { project: string | null; view: "project" | "setup" | "settings"; phoneTab: "manager" | "board" } = {
  project: null,
  view: "project",
  phoneTab: "manager",
};

export function TaroScreen({ theme, layout, params, navigation }: PluginScreenProps) {
  const projects = useProjects();
  const refresh = useRefreshProjects();
  const list = projects.data?.projects ?? [];
  const [selected, setSelected] = useState<string | null>(() => params.project ?? remembered.project);
  const [view, setView] = useState<"project" | "setup" | "settings">(() =>
    params.view === "setup" || params.view === "settings" ? params.view : remembered.view,
  );
  const current = list.find((summary) => summary.config.project === selected) ?? list[0] ?? null;
  const showing = list.length === 0 && !projects.isLoading ? "setup" : view;

  function choose(project: string | null, nextView: "project" | "setup" | "settings"): void {
    remembered.project = project;
    remembered.view = nextView;
    setSelected(project);
    setView(nextView);
  }

  const { colors } = theme;
  const styles = useMemo(
    () => ({
      root: { flex: 1, backgroundColor: colors.surface0 },
      tabs: { flexDirection: "row" as const, gap: 4, paddingHorizontal: 10, paddingTop: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
      tab: { paddingHorizontal: 12, paddingVertical: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
      tabActive: { backgroundColor: colors.surface2 },
      tabText: { color: colors.foreground, fontSize: FONT_SIZE.body },
      tabMuted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.body },
      body: { flex: 1, minHeight: 0 },
      error: { color: colors.statusDanger, padding: 16 },
    }),
    [colors],
  );

  return (
    <View style={styles.root}>
      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs} showsHorizontalScrollIndicator={false}>
        {list.map((summary) => {
          const active = showing !== "setup" && current?.config.project === summary.config.project;
          return (
            <Pressable key={summary.config.project} accessibilityRole="tab" style={[styles.tab, active ? styles.tabActive : null]} onPress={() => choose(summary.config.project, "project")}>
              <Text style={active ? styles.tabText : styles.tabMuted}>{summary.config.project}</Text>
            </Pressable>
          );
        })}
        <Pressable accessibilityRole="tab" style={[styles.tab, showing === "setup" ? styles.tabActive : null]} onPress={() => choose(selected, "setup")}>
          <Text style={showing === "setup" ? styles.tabText : styles.tabMuted}>＋ project</Text>
        </Pressable>
      </ScrollView>
      <View style={styles.body}>
        {projects.error !== null && projects.data === undefined ? <Text style={styles.error}>{errorText(projects.error)}</Text> : null}
        {showing === "setup" ? (
          <ProjectSetup
            theme={theme}
            existing={null}
            onDone={(project) => {
              refresh();
              choose(project, "project");
            }}
          />
        ) : current === null ? null : showing === "settings" ? (
          <ProjectSetup theme={theme} existing={current.config} onDone={(project) => { refresh(); choose(project, "project"); }} />
        ) : (
          <ProjectView
            summary={current}
            theme={theme}
            compact={layout.compact}
            onSettings={() => choose(current.config.project, "settings")}
            onOpenAgent={navigation === undefined ? null : (agentId) => navigation.openAgent({ agentId })}
          />
        )}
      </View>
    </View>
  );
}

function ProjectView({
  summary,
  theme,
  compact,
  onSettings,
  onOpenAgent,
}: {
  summary: ProjectSummary;
  theme: PluginTheme;
  compact: boolean;
  onSettings: () => void;
  onOpenAgent: ((agentId: string) => void) | null;
}) {
  const [phoneTab, setPhoneTab] = useState(remembered.phoneTab);
  const chat = <ManagerPane summary={summary} theme={theme} compact={compact} onSettings={onSettings} onOpenAgent={onOpenAgent} />;
  const board = <ProjectBoard summary={summary} theme={theme} compact={compact} onOpenAgent={onOpenAgent} />;
  if (compact) {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ padding: 8 }}>
          <Segmented
            theme={theme}
            value={phoneTab}
            options={[
              { value: "manager", label: "Manager" },
              { value: "board", label: "Board" },
            ]}
            onChange={(value: "manager" | "board") => {
              remembered.phoneTab = value;
              setPhoneTab(value);
            }}
          />
        </View>
        <View style={{ flex: 1 }}>{phoneTab === "manager" ? chat : board}</View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: "40%", minWidth: 320, borderRightWidth: 1, borderRightColor: theme.colors.border }}>{chat}</View>
      <View style={{ flex: 1 }}>{board}</View>
    </View>
  );
}

function ManagerPane({
  summary,
  theme,
  compact,
  onSettings,
  onOpenAgent,
}: {
  summary: ProjectSummary;
  theme: PluginTheme;
  compact: boolean;
  onSettings: () => void;
  onOpenAgent: ((agentId: string) => void) | null;
}) {
  const toast = useToast();
  const tell = useRpc(tellManager);
  const askCatchUp = useRpc(catchUp);
  const compactRpc = useRpc(compactManager);
  const project = summary.config.project;
  const manager = summary.manager;
  const header = (
    <PaneHeader theme={theme} title={`${project} · manager`}>
      {manager !== null && onOpenAgent !== null ? <IconButton icon="ExternalLink" label="Open in Paseo" theme={theme} onPress={() => onOpenAgent(manager.id)} /> : null}
      <IconButton icon="Settings" label="Project settings" theme={theme} onPress={onSettings} />
    </PaneHeader>
  );
  if (manager === null) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>
          This project has no manager running. Start one from the project's settings.
        </Text>
      </View>
    );
  }
  const running = manager.status === "running" || manager.status === "initializing";
  return (
    <View style={{ flex: 1 }}>
      {header}
      {summary.trackerSyncProblem === null ? null : (
        <Text style={{ color: theme.colors.statusWarning, paddingHorizontal: 12, paddingVertical: 6 }}>Ticket sync paused: {summary.trackerSyncProblem}</Text>
      )}
      <AgentChat
        agent={{ id: manager.id, updatedAt: manager.updatedAt, pendingPermissions: manager.pendingPermissions, status: manager.status }}
        theme={theme}
        compact={compact}
        placeholder="Tell the manager what you need…"
        onSend={async (text) => {
          await tell({ project, text });
        }}
        actions={
          <>
            <IconButton icon="Newspaper" label="Catch up" showLabel theme={theme} onPress={() => void askCatchUp({ project }).catch((caught: unknown) => toast.error(errorText(caught)))} />
            <IconButton
              icon="Minimize2"
              label="Compact"
              showLabel={!compact}
              theme={theme}
              disabled={running}
              onPress={() => void compactRpc({ project }).catch((caught: unknown) => toast.error(errorText(caught)))}
            />
            <ContextMeter theme={theme} used={manager.contextUsedTokens} max={manager.contextMaxTokens} />
          </>
        }
      />
    </View>
  );
}

export function PaneHeader({ theme, title, children }: { theme: PluginTheme; title: string; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Icon name="Bot" size={14} color={theme.colors.foregroundMuted} />
      <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" }} numberOfLines={1}>
        {title}
      </Text>
      {children}
    </View>
  );
}
