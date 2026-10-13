/**
 * The Taro screen (decision 8): Inbox, a tab per project, and "＋ project".
 * A project shows a conversation on the left — its manager, or the owner of the
 * card you opened — beside its board. On a phone (decision 12): Manager · Inbox
 * · Board tabs, and a card opens its owner full screen. The board's pane
 * switches to the project's Stats (a fourth tab on a phone).
 * Params: `project`, `view` ("setup" | "settings" | "inbox").
 */
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { catchUp, compactManager, tellManager, type Card, type ProjectSummary } from "../shared/contracts";
import { AgentChat } from "./agent-chat";
import { useBoard, useRefreshBoard } from "./board-data";
import { ProjectBoard } from "./board";
import { ContextMeter } from "./context-meter";
import { errorText } from "./format";
import { Inbox } from "./inbox";
import { OwnerPane } from "./owner-pane";
import { PaneHeader } from "./pane-header";
import { ProjectSetup } from "./project-setup";
import { useProjects, useRefreshProjects } from "./queries";
import { StatsView } from "./stats-view";
import { FONT_SIZE } from "./type-scale";
import { IconButton, Segmented } from "./ui";

type View_ = "inbox" | "project" | "setup" | "settings";
type PhoneTab = "manager" | "inbox" | "board" | "stats";
type RightPane = "board" | "stats";

/** What the screen shows, kept across remounts (the host unmounts a screen whenever the user navigates away). */
const remembered: { project: string | null; view: View_; phoneTab: PhoneTab; rightPane: RightPane; ticket: string | null } = {
  project: null,
  view: "project",
  phoneTab: "manager",
  rightPane: "board",
  ticket: null,
};

export function TaroScreen({ theme, layout, params, navigation }: PluginScreenProps) {
  const projects = useProjects();
  const refresh = useRefreshProjects();
  const list = projects.data?.projects ?? [];
  const [selected, setSelected] = useState<string | null>(() => params.project ?? remembered.project);
  const [view, setView] = useState<View_>(() =>
    params.view === "setup" || params.view === "settings" || params.view === "inbox" ? params.view : remembered.view,
  );
  const [ticket, setTicket] = useState<string | null>(() => remembered.ticket);
  const current = list.find((summary) => summary.config.project === selected) ?? list[0] ?? null;
  const showing: View_ = list.length === 0 && !projects.isLoading ? "setup" : view;
  const onOpenAgent = navigation === undefined ? null : (agentId: string) => navigation.openAgent({ agentId });

  function choose(project: string | null, nextView: View_, nextTicket: string | null = null): void {
    remembered.project = project;
    remembered.view = nextView;
    remembered.ticket = nextTicket;
    setSelected(project);
    setView(nextView);
    setTicket(nextTicket);
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

  function tab(key: string, label: string, active: boolean, onPress: () => void) {
    return (
      <Pressable key={key} accessibilityRole="tab" style={[styles.tab, active ? styles.tabActive : null]} onPress={onPress}>
        <Text style={active ? styles.tabText : styles.tabMuted}>{label}</Text>
      </Pressable>
    );
  }

  const tabs = layout.compact ? (
    // A phone: the project pill row only; Manager · Inbox · Board live inside the project view.
    <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs} showsHorizontalScrollIndicator={false}>
      {list.map((summary) =>
        tab(summary.config.project, summary.config.project, showing !== "setup" && current?.config.project === summary.config.project, () => choose(summary.config.project, "project")),
      )}
      {tab("+", "＋", showing === "setup", () => choose(selected, "setup"))}
    </ScrollView>
  ) : (
    <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs} showsHorizontalScrollIndicator={false}>
      {list.length === 0 ? null : tab("inbox", "Inbox", showing === "inbox", () => choose(selected, "inbox"))}
      {list.map((summary) =>
        tab(
          summary.config.project,
          summary.needsYou > 0 ? `${summary.config.project} · ${summary.needsYou}` : summary.config.project,
          (showing === "project" || showing === "settings") && current?.config.project === summary.config.project,
          () => choose(summary.config.project, "project"),
        ),
      )}
      {tab("+", "＋ project", showing === "setup", () => choose(selected, "setup"))}
    </ScrollView>
  );

  let body;
  if (showing === "setup") {
    body = (
      <ProjectSetup
        theme={theme}
        existing={null}
        onDone={(project) => {
          refresh();
          choose(project, "project");
        }}
      />
    );
  } else if (showing === "inbox" && !layout.compact) {
    body = <Inbox projects={list} theme={theme} compact={false} onOpenTicket={(project, card) => choose(project, "project", card.id)} />;
  } else if (current === null) {
    body = null;
  } else if (showing === "settings") {
    body = (
      <ProjectSetup
        theme={theme}
        existing={current.config}
        onDone={(project) => {
          refresh();
          choose(project, "project");
        }}
      />
    );
  } else {
    body = (
      <ProjectView
        key={current.config.project}
        summary={current}
        all={list}
        theme={theme}
        compact={layout.compact}
        ticket={ticket}
        onTicket={(next) => choose(current.config.project, "project", next)}
        onSettings={() => choose(current.config.project, "settings")}
        onOpenAgent={onOpenAgent}
        onOpenElsewhere={(project, card) => choose(project, "project", card.id)}
      />
    );
  }

  return (
    <View style={styles.root}>
      {tabs}
      <View style={styles.body}>
        {projects.error !== null && projects.data === undefined ? <Text style={styles.error}>{errorText(projects.error)}</Text> : null}
        {body}
      </View>
    </View>
  );
}

function ProjectView({
  summary,
  all,
  theme,
  compact,
  ticket,
  onTicket,
  onSettings,
  onOpenAgent,
  onOpenElsewhere,
}: {
  summary: ProjectSummary;
  all: readonly ProjectSummary[];
  theme: PluginTheme;
  compact: boolean;
  ticket: string | null;
  onTicket: (ticket: string | null) => void;
  onSettings: () => void;
  onOpenAgent: ((agentId: string) => void) | null;
  onOpenElsewhere: (project: string, card: Card) => void;
}) {
  const project = summary.config.project;
  const board = useBoard(project);
  const refreshBoard = useRefreshBoard(project);
  const [phoneTab, setPhoneTab] = useState<PhoneTab>(remembered.phoneTab);
  const [rightPane, setRightPane] = useState<RightPane>(remembered.rightPane);
  const openCard = ticket === null ? null : (board.data?.cards ?? []).find((card) => card.id === ticket) ?? null;

  const left =
    openCard === null ? (
      <ManagerPane summary={summary} theme={theme} compact={compact} onSettings={onSettings} onOpenAgent={onOpenAgent} />
    ) : (
      <OwnerPane card={openCard} project={project} theme={theme} compact={compact} onBack={() => onTicket(null)} onOpenAgent={onOpenAgent} onChanged={refreshBoard} />
    );
  const boardView = <ProjectBoard summary={summary} theme={theme} compact={compact} selectedTicket={ticket} onOpenTicket={(card) => onTicket(card.id)} />;

  if (compact) {
    if (openCard !== null) return left;
    const choosePhoneTab = (value: PhoneTab) => {
      remembered.phoneTab = value;
      setPhoneTab(value);
    };
    const needsYou = (board.data?.cards ?? []).filter((card) => card.column === "needs-you").length + (summary.trackerSyncProblem === null ? 0 : 1);
    return (
      <View style={{ flex: 1 }}>
        <View style={{ padding: 8 }}>
          <Segmented
            theme={theme}
            value={phoneTab}
            options={[
              { value: "manager", label: "Manager" },
              { value: "inbox", label: needsYou > 0 ? `Inbox ${needsYou}` : "Inbox" },
              { value: "board", label: "Board" },
              { value: "stats", label: "Stats" },
            ]}
            onChange={choosePhoneTab}
          />
        </View>
        <View style={{ flex: 1 }}>
          {phoneTab === "manager" ? (
            left
          ) : phoneTab === "inbox" ? (
            <Inbox projects={all} theme={theme} compact onOpenTicket={onOpenElsewhere} />
          ) : phoneTab === "stats" ? (
            <StatsView project={project} theme={theme} compact />
          ) : (
            boardView
          )}
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: "40%", minWidth: 340, borderRightWidth: 1, borderRightColor: theme.colors.border }}>{left}</View>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 10, paddingTop: 10, flexDirection: "row" }}>
          <Segmented
            theme={theme}
            value={rightPane}
            options={[
              { value: "board", label: "Board" },
              { value: "stats", label: "Stats" },
            ]}
            onChange={(value) => {
              remembered.rightPane = value;
              setRightPane(value);
            }}
          />
        </View>
        <View style={{ flex: 1, minHeight: 0 }}>{rightPane === "stats" ? <StatsView project={project} theme={theme} compact={false} /> : boardView}</View>
      </View>
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
        <Text style={{ color: theme.colors.foregroundMuted, padding: 16 }}>This project has no manager running. Start one from the project's settings (⚙).</Text>
      </View>
    );
  }
  const running = manager.status === "running" || manager.status === "initializing";
  return (
    <View style={{ flex: 1 }}>
      {header}
      {summary.trackerSyncProblem === null ? null : (
        <Text style={{ color: theme.colors.statusWarning, paddingHorizontal: 12, paddingVertical: 6 }}>Ticket sync paused; see Needs you on the board.</Text>
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
