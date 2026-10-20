/**
 * The Taro screen (decision 8): Inbox, a tab per project, and "＋ project".
 * A project shows a conversation on the left — its manager, or the owner of the
 * card you opened — beside its board. On a phone (decision 12): manager · Inbox
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
import { useQueryClient } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { catchUp, compactManager, reorderProjects, restartManager, resumeManager, tellManager, type Card, type ProjectSummary } from "../shared/contracts";
import { MANAGER_ACTION_LABELS, MANAGER_ACTION_SUCCESS, managerPaneNotice, offersReplaceManager, REPLACE_MANAGER_LABEL, replaceManagerNotice, type ReplaceFirstAction } from "../shared/manager-actions";
import { withoutDecisionBlocks } from "../shared/reports";
import type { StoredDecision } from "../shared/state";
import type { Suggestion } from "../shared/suggestions";
import { AgentChat } from "./agent-chat";
import { useBoard, useOpenTicketCard, useRefreshBoard } from "./board-data";
import { isOpenTicketAsked } from "./board-paging";
import { ProjectBoard } from "./board";
import { CentredLabel } from "./centred-label";
import { CountBadge } from "./count-badge";
import { countBadgeLabel, needsYouTotal } from "./count-badge-text";
import { Pressable } from "./focus";
import { errorText, formatTokenCount } from "./format";
import { Inbox } from "./inbox";
import { keptObject } from "./kept";
import { KeptPane, useRecent, useVisited } from "./kept-pane";
import { useLatestCallback } from "./latest-callback";
import { OwnerPane } from "./owner-pane";
import { PlanNavigation } from "./plan-navigation";
import { PaneHeader } from "./pane-header";
import { projectLayout } from "./pane-layout";
import { CreationProgress, NewProject, resetNewProject, returnToNewProject, useCreation } from "./new-project";
import { afterCreation, resetCreation } from "./project-creation";
import { ProjectSetup } from "./project-setup";
import { ReplaceFirstDialog } from "./replace-first-dialog";
import { ScreenLayerHost } from "./screen-layer";
import { ProjectTabs } from "./project-tabs";
import { PROJECTS_KEY, useProjects, useRefreshProjects } from "./queries";
import { paneGutter, SPACE } from "./spacing";
import { StatsView } from "./stats-view";
import { CrashCard } from "./crash-card";
import { drafts } from "./draft";
import { draftAttachments } from "./draft-attachments";
import { carryDraft } from "./draft-carry";
import { crashStep } from "./crash-trail";
import { SuggestionPills } from "./suggestion-pills";
import { TicketView } from "./ticket-view";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";
import { IconButton, Segmented } from "./ui";
import { useActions } from "./use-actions";
import { useNow } from "./use-now";
import { useBackStep, useScreenBack } from "./use-back";
import { useChatTransports } from "./use-chat-transports";
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
  // The phone's manager · Inbox · Board · Stats, one for every project as a remount gave it (TR-069).
  const [phoneTab, setPhoneTabState] = useState<PhoneTab>(remembered.phoneTab);
  const setPhoneTab = (value: PhoneTab) => {
    remembered.phoneTab = value;
    setPhoneTabState(value);
  };
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
    setPhoneTab("manager");
    choose(project, "project");
  }, [next]);

  const [plan, setPlan] = useState<OpenPlan | null>(keptPlan);
  // Counts View plan presses, so a ticket beside the chat unfolds its Plan on each (TR-149).
  const [planRequest, setPlanRequest] = useState(0);

  /** The screen now, for the moves in `back-steps.ts`. */
  function now(): ScreenNow {
    return { project: current?.config.project ?? null, view: showing, ticket: ticketOpen ? ticket : null, ticketOpen, phoneTab: remembered.phoneTab };
  }

  function go(move: ScreenMove): void {
    if (move.ticketFrom !== null) {
      remembered.ticketFromProject = move.ticketFrom.project;
      remembered.ticketFromView = move.ticketFrom.view;
    }
    if (move.phoneTab !== null) setPhoneTab(move.phoneTab);
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

  // The crash trail's step (TR-132): names and ids only.
  const shownProject = current?.config.project ?? "";
  const shownTicket = ticketOpen ? ticket : null;
  useEffect(() => {
    const where = [showing, shownProject, layout.compact ? phoneTab : "", shownTicket ?? "", plan !== null && shownTicket !== null ? "plan" : ""];
    crashStep("screen", where.filter((part) => part !== "").join(" "));
  }, [showing, shownProject, shownTicket, phoneTab, plan, layout.compact]);

  function viewPlan(project: string, planFor: string): void {
    setPlanRequest((count) => count + 1);
    go(viewPlanMove(now(), plan, project, planFor));
  }

  const { colors } = theme;
  const styles = useMemo(
    () => ({
      root: { flex: 1, backgroundColor: colors.surface0 },
      body: { flex: 1, minHeight: 0 },
      error: { color: colors.statusDanger, padding: SPACE.lg },
    }),
    [colors],
  );

  const queryClient = useQueryClient();
  const saveOrder = useRpc(reorderProjects);
  /** A dragged tab (TR-214): the new order shows at once, is saved on the daemon, then the list is read again. */
  function reorder(order: string[]): void {
    queryClient.setQueryData(PROJECTS_KEY, (data: typeof projects.data) =>
      data === undefined ? data : { ...data, projects: order.flatMap((name) => data.projects.filter((summary) => summary.config.project === name)) },
    );
    saveOrder({ order }).then(refresh, refresh);
  }

  const settingUp = showing === "setup";
  const tabProjects = list.map((summary) => ({ name: summary.config.project, needsYou: summary.needsYou }));
  const tabs = (
    <ProjectTabs
      theme={theme}
      compact={layout.compact}
      projects={tabProjects}
      active={layout.compact ? (settingUp ? null : (current?.config.project ?? null)) : showing === "project" || showing === "settings" ? (current?.config.project ?? null) : null}
      inboxActive={showing === "inbox"}
      inboxCount={needsYouTotal(list)}
      onOpenProject={(name) => choose(name, "project")}
      onOpenInbox={() => choose(selected, "inbox")}
      onNewProject={() => choose(selected, "setup")}
      onReorder={reorder}
    />
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
      />
    );
  } else if (showing === "inbox" && !layout.compact) {
    body = null;
  } else if (current === null) {
    body = null;
  } else if (showing === "settings") {
    body = (
      <ProjectSetup
        theme={theme}
        existing={current.config}
        manager={current.manager}
        onDone={(project) => {
          refresh();
          choose(project, "project");
        }}
        onCancel={() => choose(current.config.project, "project")}
      />
    );
  } else {
    body = null;
  }

  // The wide Inbox and every project shown once stay mounted, hidden, so going back draws nothing new (TR-069).
  const inboxShown = showing === "inbox" && !layout.compact;
  const inboxVisited = useVisited(inboxShown ? "inbox" : null);
  const activeProject = current !== null && body === null && !inboxShown && showing !== "setup" ? current.config.project : null;
  const projectsVisited = useRecent(activeProject, KEPT_PROJECTS);
  const openFromInbox = useLatestCallback((project: string, card: Pick<Card, "id">) => choose(project, "project", card.id));
  const kept = (
    <>
      {inboxVisited.has("inbox") ? (
        <KeptPane shown={inboxShown}>
          <MemoInbox projects={list} theme={theme} compact={false} onOpenTicket={openFromInbox} />
        </KeptPane>
      ) : null}
      {list
        .filter((summary) => projectsVisited.has(summary.config.project))
        .map((summary) => {
          const project = summary.config.project;
          const active = project === activeProject;
          return (
            <KeptPane key={project} shown={active} live>
              <ProjectView
                summary={summary}
                theme={theme}
                compact={layout.compact}
                active={active}
                ticket={active ? ticket : null}
                planOpen={active && planShown(plan, ticket)}
                planRequest={planRequest}
                phoneTab={phoneTab}
                onPhoneTab={setPhoneTab}
                onLeavePlan={() => {
                  keepPlan(null);
                  setPlan(null);
                }}
                onTicket={(next) => choose(project, "project", next)}
                onTicketBack={ticketBack}
                onShowManager={() => choose(project, "project")}
                onTicketMissing={setTicketMissing}
                backTo={(tab) => ticketBackTarget(layout.compact, tab, remembered.ticketFromView)}
                onSettings={() => choose(project, "settings")}
                onOpenAgent={onOpenAgent}
                onOpenElsewhere={(other, card) => choose(other, "project", card.id)}
              />
            </KeptPane>
          );
        })}
    </>
  );

  return (
    <PlanNavigation.Provider value={viewPlan}>
      {/* Above every pane: the manager's replace-first dialog (TR-161). */}
      <ScreenLayerHost>
        <View style={styles.root}>
          {/* Inside a ticket on a phone the conversation gets the height; Back returns to the tabs (TR-031). */}
          {layout.compact && showing === "project" && ticketOpen ? null : tabs}
          <CrashCard theme={theme} compact={layout.compact} />
          <View style={styles.body}>
            {projects.error !== null && projects.data === undefined ? <Text style={styles.error}>{errorText(projects.error)}</Text> : null}
            {body}
            {kept}
          </View>
        </View>
      </ScreenLayerHost>
    </PlanNavigation.Provider>
  );
}

/** Projects kept mounted, the one showing among them: each holds a long manager chat. */
const KEPT_PROJECTS = 3;

/** The phone's tabs in the order they are built ahead of their first use. */
const PHONE_TABS: readonly PhoneTab[] = ["manager", "board", "inbox", "stats"];

/** Each phone tab not yet shown is built hidden this long after the last, so its first switch draws nothing new either. */
const WARM_STEP_MS = 700;

function ProjectView({
  summary,
  theme,
  compact,
  active,
  ticket,
  planOpen,
  planRequest,
  phoneTab,
  onPhoneTab,
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
  theme: PluginTheme;
  compact: boolean;
  /** This project is the one showing; the others stay mounted, hidden (TR-069). */
  active: boolean;
  ticket: string | null;
  /** The phone's tab, shared by every project as one remount after another gave it. */
  phoneTab: PhoneTab;
  onPhoneTab: (tab: PhoneTab) => void;
  onTicket: (ticket: string) => void;
  /** The open ticket's Back (its button and Android's): out of a plan to where View plan was pressed, else to where the ticket was opened from. */
  onTicketBack: () => void;
  /** Closes the ticket to this project's manager, where its questions are answered. */
  onShowManager: () => void;
  /** Whether the board has loaded without the open ticket's card. */
  onTicketMissing: (missing: boolean) => void;
  /** Where the ticket's Back button returns, for the phone tab it returns to. */
  backTo: (phoneTab: PhoneTab) => string;
  /** The open ticket was opened by View plan: its Ticket tab shows, and Back returns to where it was pressed. */
  planOpen: boolean;
  /** View plan presses so far; the ticket beside the chat unfolds its Plan when it counts up while the plan is shown. */
  planRequest: number;
  /** The user left the plan for the ticket's chat: Back goes to the manager again. */
  onLeavePlan: () => void;
  onSettings: () => void;
  onOpenAgent: ((agentId: string) => void) | null;
  onOpenElsewhere: (project: string, card: Pick<Card, "id">) => void;
}) {
  const project = summary.config.project;
  const board = useBoard(project);
  const refreshBoard = useRefreshBoard(project);
  useChatTransports(project, board.data?.cards, summary.manager);
  // The phone's Inbox lists this project alone (TR-137); one array per summary keeps the memoised Inbox still.
  const inboxProjects = useMemo(() => [summary], [summary]);
  const [rightPane, setRightPane] = useState<RightPane>(remembered.rightPane);
  const [boardHidden, setBoardHiddenState] = useState(remembered.boardHidden);
  const openCard = ticket === null ? null : (board.data?.cards ?? []).find((card) => card.id === ticket) ?? null;
  const layout = projectLayout({ compact, boardHidden, ticketOpen: openCard !== null });
  const setBoardHidden = (hidden: boolean) => {
    remembered.boardHidden = hidden;
    setBoardHiddenState(hidden);
  };
  const onShowBoard = compact || layout.board ? null : () => setBoardHidden(false);
  // A ticket opened by link may be past its column's page (TR-082): the board is asked for its card before it counts as missing.
  const askForOpenCard = useOpenTicketCard(project);
  const [askingForCard, setAskingForCard] = useState(false);
  const cardNotLoaded = ticket !== null && board.data !== undefined && openCard === null;
  useEffect(() => {
    if (ticket === null) {
      void askForOpenCard(null);
      return;
    }
    if (!cardNotLoaded) return;
    setAskingForCard(true);
    void askForOpenCard(ticket).finally(() => setAskingForCard(false));
  }, [project, ticket, cardNotLoaded]);
  const boardAnswered = board.data !== undefined && !askingForCard && isOpenTicketAsked(project, ticket);
  const shownState = ticketShown({ ticket, boardLoaded: boardAnswered, cardFound: openCard !== null });
  // Only the project showing says whether its ticket is missing; a hidden one has none open.
  useEffect(() => {
    if (active) onTicketMissing(shownState === "missing");
  }, [shownState, active]);
  // Android's back is the ticket's Back button: out of a plan, to where View plan was pressed.
  useBackStep(openCard !== null, onTicketBack);
  const tabsVisited = useVisited(active && compact ? phoneTab : null);
  const rightVisited = useVisited(active && !compact && layout.board ? rightPane : null);
  const warmed = useWarmUp(PHONE_TABS.length, active && compact);
  // Every tap opens afresh, the ticket already open too, so its pane lands on whoever asks now (TR-096).
  const [opening, setOpening] = useState(0);
  const openTicket = useLatestCallback((card: Pick<Card, "id">) => {
    setOpening((count) => count + 1);
    onTicket(card.id);
  });
  // The manager's questions are answered in its chat: on a phone its tab, on a wide screen the left pane.
  const openManager = useLatestCallback(() => (compact ? onPhoneTab("manager") : onShowManager()));
  const openElsewhere = useLatestCallback(onOpenElsewhere);
  // Stable callbacks, so a tab switch does not redraw the memoised manager and ticket panes beneath it.
  const settings = useLatestCallback(onSettings);
  const changed = useLatestCallback(refreshBoard);
  const ticketBackLatest = useLatestCallback(onTicketBack);
  const leavePlan = useLatestCallback(onLeavePlan);
  const openAgentLatest = useLatestCallback((agentId: string) => onOpenAgent?.(agentId));
  const openAgent = onOpenAgent === null ? null : openAgentLatest;
  const showBoardLatest = useLatestCallback(() => onShowBoard?.());
  const showBoard = onShowBoard === null ? null : showBoardLatest;

  const managerPane = (
    <MemoManagerPane
      summary={summary}
      decisions={board.data?.managerDecisions ?? NO_DECISIONS}
      suggestions={board.data?.suggestions ?? NO_SUGGESTIONS}
      theme={theme}
      compact={compact}
      onSettings={settings}
      onOpenAgent={openAgent}
      onShowBoard={showBoard}
      onChanged={changed}
    />
  );
  const ownerPane =
    openCard === null ? null : (
      <MemoOwnerPane
        card={openCard}
        project={project}
        theme={theme}
        compact={compact}
        ticketBeside={layout.ticketBeside}
        backTo={backTo(phoneTab)}
        planOpen={planOpen}
        planRequest={planRequest}
        onBack={ticketBackLatest}
        onLeavePlan={leavePlan}
        onOpenAgent={openAgent}
        onChanged={changed}
        onShowBoard={showBoard}
        opening={opening}
      />
    );
  // The open ticket's pane over the manager's, which stays mounted beneath it for Back (TR-069).
  const left = (
    <>
      {ownerPane === null ? null : <KeptPane shown>{ownerPane}</KeptPane>}
      <KeptPane shown={ownerPane === null}>{managerPane}</KeptPane>
    </>
  );
  const boardView = <MemoBoard summary={summary} theme={theme} compact={compact} selectedTicket={ticket} onOpenTicket={openTicket} onOpenManager={openManager} onOpenAgent={openAgent} />;

  if (compact) {
    const kept = (tab: PhoneTab) => tabsVisited.has(tab) || PHONE_TABS.indexOf(tab) < warmed;
    return (
      <>
        {ownerPane === null ? null : <KeptPane shown>{ownerPane}</KeptPane>}
        {/* The tabs stay mounted under an open ticket, so its Back shows them at once (TR-069). */}
        <KeptPane shown={ownerPane === null}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingHorizontal: paneGutter(true), paddingVertical: SPACE.sm }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Segmented
                theme={theme}
                value={phoneTab}
                dense
                // Words without icons, dense: all four, the Inbox's badge and the settings button fit one row of a phone.
                options={[
                  { value: "manager", label: "Manager" },
                  // The phone's Inbox sits inside a project and lists only its items, so it counts only them (TR-137).
                  { value: "inbox", label: "Inbox", count: summary.needsYou },
                  { value: "board", label: "Board" },
                  { value: "stats", label: "Stats" },
                ]}
                onChange={onPhoneTab}
              />
            </View>
            {phoneTab === "manager" && summary.manager !== null && onOpenAgent !== null ? (
              <IconButton icon="ExternalLink" label="Open in Paseo" theme={theme} onPress={() => onOpenAgent(summary.manager?.id ?? "")} />
            ) : null}
            <IconButton icon="Settings" label="Project settings" theme={theme} onPress={onSettings} />
          </View>
          <View style={{ flex: 1 }}>
            {kept("manager") ? <KeptPane shown={phoneTab === "manager"}>{managerPane}</KeptPane> : null}
            {kept("inbox") ? (
              <KeptPane shown={phoneTab === "inbox"}>
                <MemoInbox projects={inboxProjects} theme={theme} compact onOpenTicket={openElsewhere} />
              </KeptPane>
            ) : null}
            {kept("stats") ? (
              <KeptPane shown={phoneTab === "stats"}>
                <MemoStats project={project} theme={theme} compact onOpenTicket={openTicket} />
              </KeptPane>
            ) : null}
            {kept("board") ? <KeptPane shown={phoneTab === "board"}>{boardView}</KeptPane> : null}
          </View>
        </KeptPane>
      </>
    );
  }
  if (!layout.board) {
    return (
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>{left}</View>
        {layout.ticketBeside && openCard !== null ? (
          <View style={{ width: "42%", minWidth: 360, borderLeftWidth: 1, borderLeftColor: theme.colors.border, backgroundColor: theme.colors.surface0 }}>
            <PaneHeader theme={theme} title={`${openCard.id} · ticket`} icon="ClipboardList" />
            <TicketView key={openCard.id} project={project} ticket={openCard.id} theme={theme} planRequest={planOpen ? planRequest : 0} />
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
        <View style={{ flex: 1, minHeight: 0 }}>
          {rightVisited.has("stats") ? (
            <KeptPane shown={rightPane === "stats"}>
              <MemoStats project={project} theme={theme} compact={false} onOpenTicket={openTicket} />
            </KeptPane>
          ) : null}
          {rightVisited.has("board") ? <KeptPane shown={rightPane === "board"}>{boardView}</KeptPane> : null}
        </View>
      </View>
    </View>
  );
}

const NO_DECISIONS: readonly StoredDecision[] = [];
const NO_SUGGESTIONS: readonly Suggestion[] = [];

// Redrawn only when what they show changes, not on every render of the project above them (TR-069).
const MemoBoard = memo(ProjectBoard);
const MemoInbox = memo(Inbox);
const MemoStats = memo(StatsView);
const MemoOwnerPane = memo(OwnerPane);
const MemoManagerPane = memo(ManagerPane);

/**
 * How many of `count` panes to build ahead of their first use: none at first, so the pane asked for
 * draws alone, then one more every `WARM_STEP_MS` while `enabled`.
 */
function useWarmUp(count: number, enabled: boolean): number {
  const [warmed, setWarmed] = useState(0);
  useEffect(() => {
    if (!enabled || warmed >= count) return undefined;
    const timer = setTimeout(() => setWarmed(warmed + 1), WARM_STEP_MS);
    return () => clearTimeout(timer);
  }, [enabled, warmed, count]);
  return warmed;
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
  const resume = useRpc(resumeManager);
  const replace = useRpc(restartManager);
  // The project list holds the manager: refreshed at once, so the old one's chat and its offer go now, not at the next poll.
  const refreshProjects = useRefreshProjects();
  const actions = useActions();
  const [tipOpen, setTipOpen] = useState(false);
  // The press held by the replace-first dialog (TR-161), and how to go ahead with it.
  const [asked, setAsked] = useState<{ action: ReplaceFirstAction; goAhead: () => void } | null>(null);
  // The offer appears as the cache hour passes, not only at the next poll that changes something.
  const now = useNow(60_000);
  const project = summary.config.project;
  const manager = summary.manager;
  // On a phone the switch row above already shows the Manager tab and holds the settings button (TR-031).
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
        <Text style={{ color: theme.colors.foregroundMuted, padding: SPACE.lg }}>This project has no manager running. Start one from the project's settings (⚙).</Text>
      </View>
    );
  }
  const running = manager.status === "running" || manager.status === "initializing";
  const notice = managerPaneNotice(manager);
  const tokens = manager.contextUsedTokens === null ? null : formatTokenCount(manager.contextUsedTokens);
  const replaceTip = tokens !== null && offersReplaceManager(manager, summary.managerLastTurnEndedAt, now) ? replaceManagerNotice(tokens) : null;
  const managerId = manager.id;
  /** While Replace manager is offered, a press first asks to replace (TR-161); otherwise it goes ahead. */
  function replaceFirst(action: ReplaceFirstAction, goAhead: () => void): void {
    if (replaceTip === null) goAhead();
    else setAsked({ action, goAhead });
  }
  const beforeSend = replaceTip === null ? undefined : (send: () => void) => replaceFirst("send", send);
  function replaceManager(): void {
    actions.press("replace", () => replace({ project }), {
      success: MANAGER_ACTION_SUCCESS.fresh,
      onSuccess: (started) => {
        // What was typed for the old manager waits in the fresh one's box.
        carryDraft({ text: drafts, attachments: draftAttachments }, managerId, started.agentId);
        setTipOpen(false);
        refreshProjects();
        onChanged();
      },
    });
  }
  return (
    <View style={{ flex: 1 }}>
      {header}
      {notice === null ? null : (
        <View
          style={{
            flexShrink: 0,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: SPACE.sm,
            paddingHorizontal: SPACE.md,
            paddingVertical: SPACE.sm,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.statusWarning, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small), flexGrow: 1, flexBasis: 200 }}>{notice}</Text>
          <IconButton
            icon="RotateCcw"
            label={MANAGER_ACTION_LABELS.resume}
            showLabel
            theme={theme}
            disabled={actions.busy}
            state={actions.stateOf("resume")}
            onPress={() => actions.press("resume", () => resume({ project }), { success: MANAGER_ACTION_SUCCESS.resume, onSuccess: onChanged })}
          />
        </View>
      )}
      {summary.trackerSyncProblem === null ? null : (
        <Text style={{ color: theme.colors.statusWarning, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm }}>Ticket sync paused; see Needs you on the board.</Text>
      )}
      <AgentChat
        // A restarted manager is another agent: a fresh chat, not the last one's words for a frame.
        key={manager.id}
        agent={{ id: manager.id, updatedAt: manager.updatedAt, pendingPermissions: manager.pendingPermissions, status: manager.status, turnStartedAt: manager.turnStartedAt }}
        asker={{ kind: "manager" }}
        theme={theme}
        compact={compact}
        placeholder="Tell the manager what you need…"
        transformText={withoutDecisionBlocks}
        asks={{ decisions, onAnswered: onChanged }}
        suggestions={<SuggestionPills project={project} suggestions={suggestions} theme={theme} onChanged={onChanged} beforeSend={replaceTip === null ? undefined : (send) => replaceFirst("suggestion", send)} />}
        onSend={async (text, attachments, messageId, answersRequest) => ({ queued: (await tell({ project, text, ...attachments, messageId, answersRequest })).queued })}
        beforeSend={beforeSend}
        actions={
          <>
            {/* Offered, it leads the row filled as the recommended press (TR-161). */}
            {replaceTip === null ? null : (
              <IconButton
                icon="RefreshCw"
                label={REPLACE_MANAGER_LABEL}
                showLabel
                tone="accent"
                theme={theme}
                disabled={actions.busy}
                state={actions.stateOf("replace")}
                tip={{ text: replaceTip, onShow: setTipOpen }}
                onPress={replaceManager}
              />
            )}
            <IconButton
              icon="Newspaper"
              label="Catch up"
              showLabel
              theme={theme}
              disabled={actions.busy}
              state={actions.stateOf("catch-up")}
              onPress={() => replaceFirst("catch-up", () => actions.press("catch-up", () => askCatchUp({ project })))}
            />
            <IconButton
              icon="Minimize2"
              label="Compact"
              showLabel
              theme={theme}
              disabled={running || actions.busy}
              state={actions.stateOf("compact")}
              onPress={() => replaceFirst("compact", () => actions.press("compact", () => compactRpc({ project })))}
            />
          </>
        }
        context={{ used: manager.contextUsedTokens, max: manager.contextMaxTokens }}
        identity={manager}
        actionsTip={replaceTip !== null && tipOpen ? replaceTip : null}
      />
      <ReplaceFirstDialog
        asked={asked?.action ?? null}
        tokens={tokens ?? ""}
        theme={theme}
        onReplace={() => {
          setAsked(null);
          replaceManager();
        }}
        onGoAhead={() => {
          const goAhead = asked?.goAhead;
          setAsked(null);
          goAhead?.();
        }}
        onClose={() => setAsked(null)}
      />
    </View>
  );
}
