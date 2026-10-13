/**
 * The Taro screen (decision 8): Inbox, a tab per project, and "＋ project".
 * A project shows a conversation on the left — its manager, or the owner of the
 * card you opened — beside its board. On a phone (decision 12): Manager · Inbox
 * · Board tabs, and a card opens its owner full screen. The board's pane
 * switches to the project's Stats (a fourth tab on a phone). On a wide screen the board can be
 * hidden; an open ticket then sits in a right-hand panel beside its chat.
 * Params: `project`, `view` ("setup" | "settings" | "inbox").
 */
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { catchUp, compactManager, tellManager, type Card, type ProjectSummary } from "../shared/contracts";
import { withoutDecisionBlocks } from "../shared/reports";
import type { StoredDecision } from "../shared/state";
import { AgentChat } from "./agent-chat";
import { useBoard, useRefreshBoard } from "./board-data";
import { ProjectBoard } from "./board";
import { ContextMeter } from "./context-meter";
import { errorText } from "./format";
import { Inbox } from "./inbox";
import { OwnerPane } from "./owner-pane";
import { PaneHeader } from "./pane-header";
import { projectLayout } from "./pane-layout";
import { ProjectSetup } from "./project-setup";
import { useProjects, useRefreshProjects } from "./queries";
import { SPACE } from "./spacing";
import { StatsView } from "./stats-view";
import { TicketView } from "./ticket-view";
import { FONT_SIZE } from "./type-scale";
import { IconButton, Segmented } from "./ui";

type View_ = "inbox" | "project" | "setup" | "settings";
type PhoneTab = "manager" | "inbox" | "board" | "stats";
type RightPane = "board" | "stats";

/** What the screen shows, kept across remounts (the host unmounts a screen whenever the user navigates away). */
const remembered: { project: string | null; view: View_; phoneTab: PhoneTab; rightPane: RightPane; ticket: string | null; boardHidden: boolean } = {
  project: null,
  view: "project",
  phoneTab: "manager",
  rightPane: "board",
  ticket: null,
  boardHidden: false,
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
      tabsFrame: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
      tabs: { flexDirection: "row" as const, gap: SPACE.lg, paddingHorizontal: SPACE.lg },
      // Flat tabs: the chosen one is marked by its text and a line under it, not by a box.
      tab: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.sm,
        paddingHorizontal: SPACE.xs,
        paddingTop: SPACE.md,
        paddingBottom: SPACE.md - 2,
        borderBottomWidth: 2,
        borderBottomColor: "transparent",
      },
      tabActive: { borderBottomColor: colors.accent },
      tabText: { color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const },
      tabMuted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.body, fontWeight: "500" as const },
      badge: { minWidth: 18, alignItems: "center" as const, paddingHorizontal: SPACE.xs + 1, borderRadius: 9, backgroundColor: colors.statusWarning },
      badgeText: { color: colors.surface0, fontSize: FONT_SIZE.micro, fontWeight: "700" as const },
      body: { flex: 1, minHeight: 0 },
      error: { color: colors.statusDanger, padding: SPACE.lg },
    }),
    [colors],
  );

  function tab(key: string, label: string, icon: string, active: boolean, onPress: () => void, count = 0) {
    return (
      <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label === "" ? "Add a project" : label} style={[styles.tab, active ? styles.tabActive : null]} onPress={onPress}>
        <Icon name={icon} size={15} color={active ? colors.foreground : colors.foregroundMuted} />
        {label === "" ? null : <Text style={active ? styles.tabText : styles.tabMuted}>{label}</Text>}
        {count > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  const tabs = layout.compact ? (
    // A phone: the project pill row only; Manager · Inbox · Board live inside the project view.
    <ScrollView horizontal style={styles.tabsFrame} contentContainerStyle={styles.tabs} showsHorizontalScrollIndicator={false}>
      {list.map((summary) =>
        tab(summary.config.project, summary.config.project, "FolderKanban", showing !== "setup" && current?.config.project === summary.config.project, () => choose(summary.config.project, "project")),
      )}
      {tab("+", "", "Plus", showing === "setup", () => choose(selected, "setup"))}
    </ScrollView>
  ) : (
    <ScrollView horizontal style={styles.tabsFrame} contentContainerStyle={styles.tabs} showsHorizontalScrollIndicator={false}>
      {list.length === 0 ? null : tab("inbox", "Inbox", "Inbox", showing === "inbox", () => choose(selected, "inbox"))}
      {list.map((summary) =>
        tab(
          summary.config.project,
          summary.config.project,
          "FolderKanban",
          (showing === "project" || showing === "settings") && current?.config.project === summary.config.project,
          () => choose(summary.config.project, "project"),
          summary.needsYou,
        ),
      )}
      {tab("+", "project", "Plus", showing === "setup", () => choose(selected, "setup"))}
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
        onCancel={current === null ? null : () => choose(current.config.project, "project")}
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
        onCancel={() => choose(current.config.project, "project")}
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
  const [boardHidden, setBoardHiddenState] = useState(remembered.boardHidden);
  const openCard = ticket === null ? null : (board.data?.cards ?? []).find((card) => card.id === ticket) ?? null;
  const layout = projectLayout({ compact, boardHidden, ticketOpen: openCard !== null });
  const setBoardHidden = (hidden: boolean) => {
    remembered.boardHidden = hidden;
    setBoardHiddenState(hidden);
  };
  const onShowBoard = compact || layout.board ? null : () => setBoardHidden(false);
  const choosePhoneTab = (value: PhoneTab) => {
    remembered.phoneTab = value;
    setPhoneTab(value);
  };

  const left =
    openCard === null ? (
      <ManagerPane
        summary={summary}
        decisions={board.data?.managerDecisions ?? []}
        theme={theme}
        compact={compact}
        onSettings={onSettings}
        onOpenAgent={onOpenAgent}
        onShowBoard={onShowBoard}
        onChanged={refreshBoard}
      />
    ) : (
      <OwnerPane
        card={openCard}
        project={project}
        theme={theme}
        compact={compact}
        ticketBeside={layout.ticketBeside}
        onBack={() => onTicket(null)}
        onOpenAgent={onOpenAgent}
        onChanged={refreshBoard}
        onShowBoard={onShowBoard}
      />
    );
  const boardView = (
    <ProjectBoard
      summary={summary}
      theme={theme}
      compact={compact}
      selectedTicket={ticket}
      onOpenTicket={(card) => onTicket(card.id)}
      // The manager's questions are answered in its chat: on a phone its tab, on a wide screen the left pane.
      onOpenManager={() => (compact ? choosePhoneTab("manager") : onTicket(null))}
    />
  );

  if (compact) {
    if (openCard !== null) return left;
    const needsYou = (board.data?.cards ?? []).filter((card) => card.column === "needs-you").length + (board.data?.alerts.length ?? 0) + (summary.trackerSyncProblem === null ? 0 : 1);
    return (
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: SPACE.md, paddingTop: SPACE.md, paddingBottom: SPACE.xs }}>
          <Segmented
            theme={theme}
            value={phoneTab}
            options={[
              { value: "manager", label: "Manager", icon: "Bot" },
              { value: "inbox", label: needsYou > 0 ? `Inbox ${needsYou}` : "Inbox", icon: "Inbox" },
              { value: "board", label: "Board", icon: "LayoutDashboard" },
              { value: "stats", label: "Stats", icon: "ChartColumn" },
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
  if (!layout.board) {
    return (
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>{left}</View>
        {layout.ticketBeside && openCard !== null ? (
          <View style={{ width: "42%", minWidth: 360, borderLeftWidth: 1, borderLeftColor: theme.colors.border, backgroundColor: theme.colors.surface0 }}>
            <PaneHeader theme={theme} title={`${openCard.id} · ticket`} icon="ClipboardList" />
            <TicketView key={openCard.id} project={project} ticket={openCard.id} theme={theme} />
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: "40%", minWidth: 340, borderRightWidth: 1, borderRightColor: theme.colors.border, backgroundColor: theme.colors.surface0 }}>{left}</View>
      <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
        <View style={{ paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <Segmented
            theme={theme}
            value={rightPane}
            options={[
              { value: "board", label: "Board", icon: "LayoutDashboard" },
              { value: "stats", label: "Stats", icon: "ChartColumn" },
            ]}
            onChange={(value) => {
              remembered.rightPane = value;
              setRightPane(value);
            }}
          />
          <IconButton icon="PanelRightClose" label="Hide the board" showLabel theme={theme} onPress={() => setBoardHidden(true)} />
        </View>
        <View style={{ flex: 1, minHeight: 0 }}>{rightPane === "stats" ? <StatsView project={project} theme={theme} compact={false} /> : boardView}</View>
      </View>
    </View>
  );
}

function ManagerPane({
  summary,
  decisions,
  theme,
  compact,
  onSettings,
  onOpenAgent,
  onShowBoard,
  onChanged,
}: {
  summary: ProjectSummary;
  /** The manager's open decisions, drawn in its chat where it asked them (TR-026). */
  decisions: readonly StoredDecision[];
  theme: PluginTheme;
  compact: boolean;
  onSettings: () => void;
  onOpenAgent: ((agentId: string) => void) | null;
  /** Brings the hidden board back; null while it shows. */
  onShowBoard: (() => void) | null;
  onChanged: () => void;
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
      {onShowBoard === null ? null : <IconButton icon="PanelRightOpen" label="Show the board" showLabel theme={theme} onPress={onShowBoard} />}
    </PaneHeader>
  );
  if (manager === null) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <Text style={{ color: theme.colors.foregroundMuted, padding: SPACE.lg }}>This project has no manager running. Start one from the project's settings (⚙).</Text>
      </View>
    );
  }
  const running = manager.status === "running" || manager.status === "initializing";
  return (
    <View style={{ flex: 1 }}>
      {header}
      {summary.trackerSyncProblem === null ? null : (
        <Text style={{ color: theme.colors.statusWarning, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm }}>Ticket sync paused; see Needs you on the board.</Text>
      )}
      <AgentChat
        // A restarted manager is another agent: a fresh chat, not the last one's words for a frame.
        key={manager.id}
        agent={{ id: manager.id, updatedAt: manager.updatedAt, pendingPermissions: manager.pendingPermissions, status: manager.status }}
        theme={theme}
        compact={compact}
        placeholder="Tell the manager what you need…"
        transformText={withoutDecisionBlocks}
        asks={{ decisions, onAnswered: onChanged }}
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
