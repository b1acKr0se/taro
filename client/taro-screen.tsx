/**
 * The Taro screen (decision 8): Inbox, a tab per project, and "＋ project".
 * A project shows a conversation on the left — its manager, or the owner of the
 * card you opened — beside its board. On a phone (decision 12): Manager · Inbox
 * · Board tabs, and a card opens its owner full screen. The board's pane
 * switches to the project's Stats (a fourth tab on a phone). On a wide screen the board can be
 * hidden; an open ticket then sits in a right-hand panel beside its chat. View plan on a scope
 * approval (TR-061) opens its ticket's Ticket tab, and Back returns to where it was pressed.
 * Params: `project`, `view` ("setup" | "settings" | "inbox").
 */
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { catchUp, compactManager, tellManager, type Card, type ProjectSummary } from "../shared/contracts";
import { withoutDecisionBlocks } from "../shared/reports";
import type { StoredDecision } from "../shared/state";
import type { Suggestion } from "../shared/suggestions";
import { AgentChat } from "./agent-chat";
import { useBoard, useRefreshBoard } from "./board-data";
import { ProjectBoard } from "./board";
import { errorText } from "./format";
import { Inbox } from "./inbox";
import { keptObject } from "./kept";
import { OwnerPane } from "./owner-pane";
import { PlanNavigation } from "./plan-navigation";
import { PaneHeader } from "./pane-header";
import { projectLayout } from "./pane-layout";
import { CreationProgress, NewProject, resetNewProject, returnToNewProject, useCreation } from "./new-project";
import { afterCreation, resetCreation } from "./project-creation";
import { ProjectSetup } from "./project-setup";
import { useProjects, useRefreshProjects } from "./queries";
import { paneGutter, SPACE } from "./spacing";
import { StatsView } from "./stats-view";
import { SuggestionPills } from "./suggestion-pills";
import { TicketView } from "./ticket-view";
import { FONT_SIZE } from "./type-scale";
import { IconButton, Segmented } from "./ui";
import { useActions } from "./use-actions";
import { useBackStep, useScreenBack } from "./use-back";
import { chooseMove, planShown, screenBackStep, ticketBackMove, ticketBackTarget, ticketShown, viewPlanMove, type OpenPlan, type PhoneTab, type ScreenMove, type ScreenNow, type ScreenView } from "./back-steps";

type View_ = ScreenView;
type RightPane = "board" | "stats";

/**
 * What the screen shows, kept across remounts (the host unmounts a screen whenever the user navigates away)
 * and across the bundle's re-evaluation when the host's connection comes back (TR-038).
 */
const remembered = keptObject(globalThis, "screen-view", {
  project: null as string | null,
  view: "project" as View_,
  phoneTab: "manager" as PhoneTab,
  rightPane: "board" as RightPane,
  ticket: null as string | null,
  boardHidden: false,
  // Where the open ticket was opened from, for Back (TR-065): the project and the wide Inbox or the project.
  ticketFromProject: null as string | null,
  ticketFromView: "project" as "inbox" | "project",
});

/**
 * View plan (TR-061): the ticket whose plan is open (null when none), and where Back returns to.
 * Its own slot, flat, so the fields keep their kinds (`kept.ts` keeps no object in a null field).
 */
const planReturn = keptObject(globalThis, "plan-return", {
  ticket: null as string | null,
  view: "project" as View_,
  project: null as string | null,
  openTicket: null as string | null,
  phoneTab: "manager" as PhoneTab,
});

function keptPlan(): OpenPlan | null {
  if (planReturn.ticket === null) return null;
  return { ticket: planReturn.ticket, back: { project: planReturn.project, view: planReturn.view, ticket: planReturn.openTicket, phoneTab: planReturn.phoneTab } };
}

function keepPlan(plan: OpenPlan | null): void {
  planReturn.ticket = plan?.ticket ?? null;
  if (plan === null) return;
  planReturn.project = plan.back.project;
  planReturn.view = plan.back.view;
  planReturn.openTicket = plan.back.ticket;
  planReturn.phoneTab = plan.back.phoneTab;
}

export function TaroScreen({ theme, layout, params, navigation }: PluginScreenProps) {
  const projects = useProjects();
  const refresh = useRefreshProjects();
  const list = projects.data?.projects ?? [];
  const [selected, setSelected] = useState<string | null>(() => params.project ?? remembered.project);
  const [view, setView] = useState<View_>(() =>
    params.view === "setup" || params.view === "settings" || params.view === "inbox" ? params.view : remembered.view,
  );
  const [ticket, setTicket] = useState<string | null>(() => remembered.ticket);
  // Set by the project view once its board has loaded without the ticket's card (TR-065).
  const [ticketMissing, setTicketMissing] = useState(false);
  const ticketOpen = ticket !== null && !ticketMissing;
  const current = list.find((summary) => summary.config.project === selected) ?? list[0] ?? null;
  const showing: View_ = list.length === 0 && !projects.isLoading ? "setup" : view;
  const onOpenAgent = navigation === undefined ? null : (agentId: string) => navigation.openAgent({ agentId });
  const { state: creating, refresh: refreshCreation } = useCreation();
  const next = afterCreation({
    step: creating.step,
    listed: list.some((summary) => summary.config.project === creating.project),
    onSetup: showing === "setup",
  });

  useEffect(() => {
    if (next === "refresh") refresh();
    if (next !== "open-manager" && next !== "reset") return;
    const project = creating.project;
    resetCreation();
    resetNewProject();
    refreshCreation();
    if (next === "reset" || project === null) return;
    remembered.phoneTab = "manager";
    choose(project, "project");
  }, [next]);

  const [plan, setPlan] = useState<OpenPlan | null>(keptPlan);

  /** The screen now, for the moves in `back-steps.ts`. */
  function now(): ScreenNow {
    return { project: current?.config.project ?? null, view: showing, ticket: ticketOpen ? ticket : null, ticketOpen, phoneTab: remembered.phoneTab };
  }

  function go(move: ScreenMove): void {
    if (move.ticketFrom !== null) {
      remembered.ticketFromProject = move.ticketFrom.project;
      remembered.ticketFromView = move.ticketFrom.view;
    }
    if (move.phoneTab !== null) remembered.phoneTab = move.phoneTab;
    keepPlan(move.plan);
    setPlan(move.plan);
    remembered.project = move.project;
    remembered.view = move.view;
    remembered.ticket = move.ticket;
    setSelected(move.project);
    setView(move.view);
    setTicket(move.ticket);
    setTicketMissing(false);
  }

  function choose(project: string | null, nextView: View_, nextTicket: string | null = null): void {
    go(chooseMove(now(), project, nextView, nextTicket));
  }

  /** The open ticket's Back, its button's and Android's: from a plan to where View plan was pressed, else to where the ticket was opened from. */
  function ticketBack(): void {
    go(ticketBackMove(now(), plan, { project: remembered.ticketFromProject, view: remembered.ticketFromView }));
  }

  useScreenBack(() => {
    const step = screenBackStep({ view: showing, hasProject: current !== null, creating: creating.step !== "idle" });
    if (step !== "to-project" || current === null) return false;
    if (showing === "setup") resetNewProject();
    choose(current.config.project, "project");
    return true;
  });

  function viewPlan(project: string, planFor: string): void {
    go(viewPlanMove(now(), plan, project, planFor));
  }

  const { colors } = theme;
  const styles = useMemo(
    () => ({
      root: { flex: 1, backgroundColor: colors.surface0 },
      // The project tabs scroll; New project stays at the bar's right end, apart from them (TR-031).
      tabBar: { flexDirection: "row" as const, alignItems: "center" as const, borderBottomWidth: 1, borderBottomColor: colors.border, paddingRight: paneGutter(false) },
      tabsFrame: { flexGrow: 1, flexShrink: 1 },
      newProject: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.xs,
        marginLeft: SPACE.md,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.xs,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      newProjectActive: { borderColor: colors.accent },
      newProjectRound: { paddingHorizontal: SPACE.xs + 2, paddingVertical: SPACE.xs + 2, borderRadius: 16 },
      newProjectText: { color: colors.foreground, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      tabs: { flexDirection: "row" as const, gap: SPACE.lg, paddingHorizontal: paneGutter(false) },
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
      <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label} style={[styles.tab, active ? styles.tabActive : null]} onPress={onPress}>
        <Icon name={icon} size={15} color={active ? colors.foreground : colors.foregroundMuted} />
        <Text style={active ? styles.tabText : styles.tabMuted}>{label}</Text>
        {count > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  const settingUp = showing === "setup";
  const newProject = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New project"
      accessibilityState={{ selected: settingUp }}
      style={[styles.newProject, layout.compact ? styles.newProjectRound : null, settingUp ? styles.newProjectActive : null]}
      onPress={() => choose(selected, "setup")}
    >
      <Icon name="Plus" size={layout.compact ? 16 : 13} color={settingUp ? colors.accent : colors.foreground} />
      {layout.compact ? null : <Text style={styles.newProjectText}>New project</Text>}
    </Pressable>
  );

  const projectTabs = layout.compact ? (
    // A phone: the project pill row only; Manager · Inbox · Board live inside the project view.
    <ScrollView horizontal style={styles.tabsFrame} contentContainerStyle={styles.tabs} showsHorizontalScrollIndicator={false}>
      {list.map((summary) =>
        tab(summary.config.project, summary.config.project, "FolderKanban", !settingUp && current?.config.project === summary.config.project, () => choose(summary.config.project, "project")),
      )}
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
    </ScrollView>
  );
  const tabs = (
    <View style={styles.tabBar}>
      {projectTabs}
      {newProject}
    </View>
  );

  let body;
  if (showing === "setup" && creating.step !== "idle") {
    body = (
      <CreationProgress
        theme={theme}
        state={creating}
        onOpenProject={(project) => {
          resetCreation();
          resetNewProject();
          refreshCreation();
          refresh();
          choose(project, "project");
        }}
        onBackToSetup={(error) => {
          resetCreation();
          returnToNewProject(error);
          refreshCreation();
        }}
      />
    );
  } else if (showing === "setup") {
    body = (
      <NewProject
        theme={theme}
        compact={layout.compact}
        onOpenProject={(project) => {
          resetNewProject();
          choose(project, "project");
        }}
        onCreating={() => {
          // The first project's setup page shows only while the list is empty; keep it once the project is listed.
          choose(selected, "setup");
          refreshCreation();
          refresh();
        }}
        onCancel={
          current === null
            ? null
            : () => {
                resetNewProject();
                choose(current.config.project, "project");
              }
        }
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
        planOpen={planShown(plan, ticket)}
        onLeavePlan={() => {
          keepPlan(null);
          setPlan(null);
        }}
        onTicket={(next) => choose(current.config.project, "project", next)}
        onTicketBack={ticketBack}
        onShowManager={() => choose(current.config.project, "project")}
        onTicketMissing={setTicketMissing}
        backTo={(phoneTab) => ticketBackTarget(layout.compact, phoneTab, remembered.ticketFromView)}
        onSettings={() => choose(current.config.project, "settings")}
        onOpenAgent={onOpenAgent}
        onOpenElsewhere={(project, card) => choose(project, "project", card.id)}
      />
    );
  }

  return (
    <PlanNavigation.Provider value={viewPlan}>
      <View style={styles.root}>
        {/* Inside a ticket on a phone the conversation gets the height; Back returns to the tabs (TR-031). */}
        {layout.compact && showing === "project" && ticketOpen ? null : tabs}
        <View style={styles.body}>
          {projects.error !== null && projects.data === undefined ? <Text style={styles.error}>{errorText(projects.error)}</Text> : null}
          {body}
        </View>
      </View>
    </PlanNavigation.Provider>
  );
}

function ProjectView({
  summary,
  all,
  theme,
  compact,
  ticket,
  planOpen,
  onLeavePlan,
  onTicket,
  onTicketBack,
  onShowManager,
  onTicketMissing,
  backTo,
  onSettings,
  onOpenAgent,
  onOpenElsewhere,
}: {
  summary: ProjectSummary;
  all: readonly ProjectSummary[];
  theme: PluginTheme;
  compact: boolean;
  ticket: string | null;
  onTicket: (ticket: string) => void;
  /** The open ticket's Back (its button and Android's): out of a plan to where View plan was pressed, else to where the ticket was opened from. */
  onTicketBack: () => void;
  /** Closes the ticket to this project's Manager, where its questions are answered. */
  onShowManager: () => void;
  /** Whether the board has loaded without the open ticket's card. */
  onTicketMissing: (missing: boolean) => void;
  /** Where the ticket's Back button returns, for the phone tab it returns to. */
  backTo: (phoneTab: PhoneTab) => string;
  /** The open ticket was opened by View plan: its Ticket tab shows, and Back returns to where it was pressed. */
  planOpen: boolean;
  /** The user left the plan for the ticket's chat: Back goes to the Manager again. */
  onLeavePlan: () => void;
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
  const shownState = ticketShown({ ticket, boardLoaded: board.data !== undefined, cardFound: openCard !== null });
  useEffect(() => onTicketMissing(shownState === "missing"), [shownState]);
  // Android's back is the ticket's Back button: out of a plan, to where View plan was pressed.
  useBackStep(openCard !== null, onTicketBack);

  const left =
    openCard === null ? (
      <ManagerPane
        summary={summary}
        decisions={board.data?.managerDecisions ?? []}
        suggestions={board.data?.suggestions ?? []}
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
        backTo={backTo(phoneTab)}
        planOpen={planOpen}
        onBack={onTicketBack}
        onLeavePlan={onLeavePlan}
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
      onOpenManager={() => (compact ? choosePhoneTab("manager") : onShowManager())}
    />
  );

  if (compact) {
    if (openCard !== null) return left;
    // The Inbox lists every project, so its tab counts them all, as the sidebar does (TR-064).
    const needsYou = all.reduce((total, project) => total + project.needsYou, 0);
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingHorizontal: paneGutter(true), paddingVertical: SPACE.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Segmented
              theme={theme}
              value={phoneTab}
              // Words without icons: all four and the settings button fit one row of a phone.
              options={[
                { value: "manager", label: "Manager" },
                { value: "inbox", label: needsYou > 0 ? `Inbox ${needsYou}` : "Inbox" },
                { value: "board", label: "Board" },
                { value: "stats", label: "Stats" },
              ]}
              onChange={choosePhoneTab}
            />
          </View>
          {phoneTab === "manager" && summary.manager !== null && onOpenAgent !== null ? (
            <IconButton icon="ExternalLink" label="Open in Paseo" theme={theme} onPress={() => onOpenAgent(summary.manager?.id ?? "")} />
          ) : null}
          <IconButton icon="Settings" label="Project settings" theme={theme} onPress={onSettings} />
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
  suggestions,
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
  /** Its suggestions, offered above its composer (TR-045). */
  suggestions: readonly Suggestion[];
  theme: PluginTheme;
  compact: boolean;
  onSettings: () => void;
  onOpenAgent: ((agentId: string) => void) | null;
  /** Brings the hidden board back; null while it shows. */
  onShowBoard: (() => void) | null;
  onChanged: () => void;
}) {
  const tell = useRpc(tellManager);
  const askCatchUp = useRpc(catchUp);
  const compactRpc = useRpc(compactManager);
  const actions = useActions();
  const project = summary.config.project;
  const manager = summary.manager;
  // On a phone the switch row above already says Manager and holds the settings button (TR-031).
  const header = compact ? null : (
    <PaneHeader theme={theme} title={`${project} · Manager`}>
      {manager !== null && onOpenAgent !== null ? <IconButton icon="ExternalLink" label="Open in Paseo" theme={theme} onPress={() => onOpenAgent(manager.id)} /> : null}
      <IconButton icon="Settings" label="Project settings" theme={theme} onPress={onSettings} />
      {onShowBoard === null ? null : <IconButton icon="PanelRightOpen" label="Show the board" showLabel theme={theme} onPress={onShowBoard} />}
    </PaneHeader>
  );
  if (manager === null) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <Text style={{ color: theme.colors.foregroundMuted, padding: SPACE.lg }}>This project has no Manager running. Start one from the project's settings (⚙).</Text>
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
        placeholder="Tell the Manager what you need…"
        transformText={withoutDecisionBlocks}
        asks={{ decisions, onAnswered: onChanged }}
        suggestions={<SuggestionPills project={project} suggestions={suggestions} theme={theme} onChanged={onChanged} />}
        onSend={async (text, attachments) => {
          await tell({ project, text, ...attachments });
        }}
        actions={
          <>
            <IconButton
              icon="Newspaper"
              label="Catch up"
              showLabel
              theme={theme}
              disabled={actions.busy}
              state={actions.stateOf("catch-up")}
              onPress={() => actions.press("catch-up", () => askCatchUp({ project }))}
            />
            <IconButton
              icon="Minimize2"
              label="Compact"
              showLabel
              theme={theme}
              disabled={running || actions.busy}
              state={actions.stateOf("compact")}
              onPress={() => actions.press("compact", () => compactRpc({ project }))}
            />
          </>
        }
        context={{ used: manager.contextUsedTokens, max: manager.contextMaxTokens }}
      />
    </View>
  );
}
