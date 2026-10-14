/**
 * The ticket beside its owner's chat, made to scan (TR-061, design B): a summary block with no
 * heading (status, what the ticket needs from the user, its goal, its result once delivered), then
 * one-line rows in a fixed order (Plan, a parent's children, Result, Evidence, Milestones,
 * Description, Records), each with a muted summary, that open or fold when tapped. What the block
 * and the rows say is `shared/ticket-summary.ts`; this file draws it.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { answerDecision, listOpenDecisions, loadTicket, pauseTicket, resumeTicket } from "../shared/contracts";
import { ticketViewApproval } from "../shared/decision-view";
import { descriptionParts } from "../shared/description";
import { finalSummaryBody } from "../shared/execution";
import { FINAL_SECTIONS, finalSections, type FinalSections } from "../shared/final-summary";
import { ticketMilestones, type Milestone } from "../shared/milestones";
import type { PauseView } from "../shared/pause";
import { parsePlan } from "../shared/plan";
import type { StoredDecision } from "../shared/state";
import { foldList, ticketSections, ticketSummary, type TicketSectionKey, type TicketSummary } from "../shared/ticket-summary";
import { PhaseBadge } from "./badges";
import { pauseLines } from "./card-now";
import { EvidenceBlock } from "./evidence-view";
import { Pressable } from "./focus";
import { errorText } from "./format";
import { KeyboardScrollView } from "./keyboard";
import { Markdown, MarkdownInline } from "./markdown";
import { PlanActions, PlanBody, type PlanCardOptions } from "./plan-card";
import { withAlpha } from "./tint";
import { recentMilestoneRows } from "./milestone-rows";
import { paneGutter, SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { Chip, IconButton, MONOSPACE } from "./ui";
import { useActions, type Actions } from "./use-actions";
import { recordKindLook, toneColor } from "./visual-meta";
import { polled } from "./polling";
import { useNow } from "./use-now";

/** The timeline's dot, the rail column it sits in, and the clock column before it. */
const DOT = 10;
const RAIL = 16;
const CLOCK = 40;
/** Evidence shows this many screenshots before "+N more". */
const SCREENSHOTS_SHOWN = 4;
/** Below this width a row's summary sits under its name instead of beside it (a phone). */
const STACK_BELOW_WIDTH = 380;
/** The names' column where the summary sits beside them, so the summaries line up; "DESCRIPTION" fits. */
const NAME_COLUMN = 104;
/** The summary block's icon and label columns; "Needs you:" fits the label column. */
const SUMMARY_ICON = 16;
const SUMMARY_LABEL = 100;

const SECTION_LOOK: Record<TicketSectionKey, { icon: string; name: string }> = {
  plan: { icon: "Map", name: "Plan" },
  children: { icon: "ListTree", name: "Children" },
  result: { icon: "PackageCheck", name: "Result" },
  evidence: { icon: "ClipboardCheck", name: "Evidence" },
  milestones: { icon: "Flag", name: "Milestones" },
  description: { icon: "FileText", name: "Description" },
  records: { icon: "ScrollText", name: "Records" },
};

export function TicketView({ project, ticket, theme, answeredFrom = "screen" }: { project: string; ticket: string; theme: PluginTheme; answeredFrom?: "screen" | "tab" }) {
  const load = useRpc(loadTicket);
  const listDecisions = useRpc(listOpenDecisions);
  const toast = useToast();
  const detail = useQuery({ queryKey: ["taro", "ticket", project, ticket], queryFn: () => load({ project, ticket }), ...polled(6_000) });
  const decisions = useQuery({ queryKey: ["taro", "decisions", project], queryFn: () => listDecisions({ project }), ...polled(4_000) });
  // A row the user opened or folded stays so; the others follow the ticket (Plan while it waits for approval).
  const [toggled, setToggled] = useState<Partial<Record<TicketSectionKey, boolean>>>({});
  const [width, setWidth] = useState<number | null>(null);
  const planSource = detail.data?.plan ?? null;
  const plan = useMemo(() => parsePlan(planSource), [planSource]);
  const allDecisions = decisions.data?.decisions;
  const open = useMemo(() => (allDecisions ?? []).filter((decision) => decision.ticket === ticket && decision.status === "open"), [allDecisions, ticket]);
  // The open scope approval is answered here (beside Needs you, and at the end of the plan after reading it), plan template or not.
  const approving = useMemo(() => ticketViewApproval(open, ticket), [open, ticket]);
  // One owner of both Approve presses: while one is in flight the other is disabled.
  const approvePresses = useActions();
  const pauseRpc = useRpc(pauseTicket);
  const resumeRpc = useRpc(resumeTicket);
  const pausePresses = useActions();
  // What Pause and Resume did is the server's to say (TR-088).
  const told = (result: { message: string }) => {
    toast.show(result.message, { variant: "success" });
    void detail.refetch();
  };
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      body: { paddingVertical: SPACE.lg, paddingHorizontal: paneGutter(false), gap: SPACE.lg },
      line: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: SPACE.sm },
      lineIcon: { marginTop: 2 },
      text: { flex: 1, color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      muted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, padding: SPACE.lg },
      notes: { color: colors.foreground, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption), fontFamily: MONOSPACE },
      notesFrame: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: SPACE.md, backgroundColor: colors.surface1 },
      subheading: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "700" as const },
      planActions: { marginTop: SPACE.sm },
      // Whole: the title beside it wraps instead.
      childBadge: { flexShrink: 0 },
    }),
    [colors],
  );
  const data = detail.data;
  const summary = useMemo(() => (data === undefined ? null : ticketSummary(data, open)), [data, open]);
  const sections = useMemo(() => (data === undefined ? [] : ticketSections(data, open)), [data, open]);
  if (detail.error !== null && data === undefined) return <Text style={styles.muted}>{errorText(detail.error)}</Text>;
  if (data === undefined || summary === null) return <Text style={styles.muted}>Loading the ticket…</Text>;
  const noop = () => undefined;
  // The delivery names the PR; the user opens it from here before accepting (decision 34).
  const openLink = (url: string) => void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  const stacked = width !== null && width < STACK_BELOW_WIDTH;

  // An older ticket's criteria: inside the plan, under How I'll prove it.
  const criteria =
    data.acceptanceCriteria.length === 0 ? null : (
      <View style={{ gap: SPACE.sm }}>
        {data.acceptanceCriteria.map((criterion) => (
          <View key={criterion.index} style={styles.line}>
            <View style={styles.lineIcon}>
              <Icon name={criterion.checked ? "SquareCheck" : "Square"} size={15} color={criterion.checked ? colors.statusSuccess : colors.foregroundMuted} />
            </View>
            <Text style={styles.text}>{criterion.text}</Text>
          </View>
        ))}
      </View>
    );

  function body(key: TicketSectionKey): ReactNode {
    if (data === undefined) return null;
    switch (key) {
      case "plan":
        return (
          <View style={{ gap: SPACE.sm }}>
            {plan !== null ? (
              <PlanBody plan={plan} theme={theme} proof={criteria} />
            ) : (
              <View style={{ gap: SPACE.md }}>
                {/* A plan in no template shape stays Markdown, as written. */}
                {data.plan === null ? null : <Markdown source={data.plan} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} foldParagraphs />}
                {criteria === null ? null : (
                  <View style={{ gap: SPACE.xs }}>
                    <Text accessibilityRole="header" style={styles.subheading}>
                      How I’ll prove it
                    </Text>
                    {criteria}
                  </View>
                )}
              </View>
            )}
            {approving === null ? null : (
              <View style={styles.planActions}>
                <PlanActions decision={approving.decision} options={approving.options} presses={approvePresses} theme={theme} answeredFrom={answeredFrom} onAnswered={() => void decisions.refetch()} />
              </View>
            )}
          </View>
        );
      case "children":
        return (
          <View style={{ gap: SPACE.sm }}>
            {data.children.map((child) => (
              // The badge ends the row, so every id and title starts at one edge whatever its status's length.
              <View key={child.id} style={styles.line}>
                <Text style={[styles.text, { minWidth: 0 }]}>
                  <Text style={{ color: colors.foregroundMuted, fontWeight: "600" }}>{child.id}</Text> {child.title}
                </Text>
                <View style={styles.childBadge}>
                  <PhaseBadge theme={theme} status={child.status ?? "Unknown"} />
                </View>
              </View>
            ))}
          </View>
        );
      case "result":
        return data.finalSummary === null ? null : <ResultBody finalSummary={data.finalSummary} theme={theme} onOpenLink={openLink} />;
      case "evidence":
        return data.evidence === null ? null : <EvidenceBlock evidence={data.evidence} theme={theme} screenshotLimit={SCREENSHOTS_SHOWN} />;
      case "milestones":
        return <Timeline notes={data.notes} theme={theme} onOpenLink={openLink} />;
      case "description":
        return <DescriptionBody description={data.description ?? ""} theme={theme} onOpenLink={noop} />;
      case "records":
        return (
          <View style={styles.notesFrame}>
            <Text selectable style={styles.notes}>
              {data.notes}
            </Text>
          </View>
        );
    }
  }

  return (
    <KeyboardScrollView contentContainerStyle={styles.body}>
      <SummaryBlock
        theme={theme}
        status={data.status}
        labels={data.labels}
        pause={data.pause}
        pauseAction={
          data.pausable
            ? { kind: "pause", run: () => pausePresses.press("pause", () => pauseRpc({ project, ticket }), { after: "hold", onSuccess: told }), state: pausePresses.stateOf("pause"), busy: pausePresses.busy }
            : data.pause?.state === "paused"
              ? { kind: "resume", run: () => pausePresses.press("resume", () => resumeRpc({ project, ticket }), { after: "hold", onSuccess: told }), state: pausePresses.stateOf("resume"), busy: pausePresses.busy }
              : null
        }
        summary={summary}
        approve={approving === null ? null : { ...approving, presses: approvePresses }}
        answeredFrom={answeredFrom}
        onAnswered={() => void decisions.refetch()}
        onOpenLink={openLink}
      />
      {sections.length === 0 ? null : (
        <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {sections.map((section, index) => {
            const expanded = toggled[section.key] ?? section.open;
            return (
              <SectionRow
                key={section.key}
                theme={theme}
                icon={SECTION_LOOK[section.key].icon}
                name={SECTION_LOOK[section.key].name}
                summary={section.summary}
                expanded={expanded}
                stacked={stacked}
                last={index === sections.length - 1}
                onToggle={() => setToggled((current) => ({ ...current, [section.key]: !expanded }))}
              >
                {expanded ? body(section.key) : null}
              </SectionRow>
            );
          })}
        </View>
      )}
    </KeyboardScrollView>
  );
}

/** Status and labels, then Needs you, Goal and Result as rows of one grid: icon, label, value. */
function SummaryBlock({
  theme,
  status,
  labels,
  pause,
  pauseAction,
  summary,
  approve,
  answeredFrom,
  onAnswered,
  onOpenLink,
}: {
  theme: PluginTheme;
  status: string;
  labels: readonly string[];
  pause: PauseView | null;
  /** Pause for a ticket under way, Resume for a paused one (TR-088). */
  pauseAction: { kind: "pause" | "resume"; run: () => void; state: "busy" | "done" | undefined; busy: boolean } | null;
  summary: TicketSummary;
  approve: { decision: StoredDecision; options: PlanCardOptions; presses: Actions } | null;
  answeredFrom: "screen" | "tab";
  onAnswered: () => void;
  onOpenLink: (url: string) => void;
}) {
  const { colors } = theme;
  const now = useNow();
  const wanted = summary.need !== "nothing";
  const text = { flex: 1, minWidth: 0, color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) };
  const label = { width: SUMMARY_LABEL, flexShrink: 0, color: colors.foregroundMuted, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body), fontWeight: "700" as const };
  const line = { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: SPACE.sm };
  const iconBox = { width: SUMMARY_ICON, height: lineHeightFor(FONT_SIZE.body), justifyContent: "center" as const, flexShrink: 0 };
  // Every row is icon, label, value in three fixed columns, so the values and their wrapped lines start at one edge.
  const row = (icon: string, iconColor: string, name: string, value: ReactNode, labelColor = colors.foregroundMuted) => (
    <View style={line}>
      <View style={iconBox}>
        <Icon name={icon} size={15} color={iconColor} />
      </View>
      <Text style={[label, { color: labelColor }]} numberOfLines={1}>
        {name}
      </Text>
      {value}
    </View>
  );
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface1, padding: SPACE.md, gap: SPACE.sm }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm }}>
        <PhaseBadge theme={theme} status={status} />
        {labels.map((each) => (
          <Chip key={each} theme={theme} icon="Tag" text={each} color={colors.foregroundMuted} />
        ))}
        {pauseAction === null ? null : (
          <View style={{ marginLeft: "auto" }}>
            <IconButton
              icon={pauseAction.kind === "pause" ? "Pause" : "Play"}
              label={pauseAction.kind === "pause" ? "Pause" : "Resume"}
              showLabel
              theme={theme}
              disabled={pauseAction.busy}
              state={pauseAction.state}
              onPress={pauseAction.run}
            />
          </View>
        )}
      </View>
      {pause === null
        ? null
        : row(
            pause.state === "queued-to-resume" ? "Clock" : "Pause",
            colors.foregroundMuted,
            pause.state === "pausing" ? "Pausing:" : pause.state === "paused" ? "Paused:" : "Resuming:",
            <Text style={text}>{[pauseLines(pause, now).headline, pauseLines(pause, now).detail].filter((part) => part !== null).join(" · ")}</Text>,
          )}
      {row(
        wanted ? "Hand" : "CircleCheck",
        wanted ? colors.statusWarning : colors.foregroundMuted,
        "Needs you:",
        // Approve sits under the words it answers, in the value column.
        <View style={{ flex: 1, minWidth: 0, alignItems: "flex-start", gap: SPACE.sm }}>
          <Text style={[text, { flex: undefined, alignSelf: "stretch", color: wanted ? colors.statusWarning : colors.foregroundMuted }]}>{summary.needText}</Text>
          {approve === null ? null : <SummaryApprove decision={approve.decision} options={approve.options} presses={approve.presses} theme={theme} answeredFrom={answeredFrom} onAnswered={onAnswered} />}
        </View>,
        wanted ? colors.statusWarning : colors.foregroundMuted,
      )}
      {row(
        "Star",
        colors.foregroundMuted,
        "Goal:",
        <Text style={text}>
          <MarkdownInline text={summary.goal} theme={theme} fontSize={FONT_SIZE.body} onOpenLink={onOpenLink} />
        </Text>,
      )}
      {summary.result === null
        ? null
        : row(
            "Check",
            colors.statusSuccess,
            "Result:",
            <Text style={text}>
              <MarkdownInline text={summary.result} theme={theme} fontSize={FONT_SIZE.body} onOpenLink={onOpenLink} />
            </Text>,
          )}
    </View>
  );
}

/** Approve beside Needs you: the plan's own Approve, for a user who has read it already; it shares the plan row's presses. */
function SummaryApprove({
  decision,
  options,
  presses,
  theme,
  answeredFrom,
  onAnswered,
}: {
  decision: StoredDecision;
  options: PlanCardOptions;
  presses: Actions;
  theme: PluginTheme;
  answeredFrom: "screen" | "tab";
  onAnswered: () => void;
}) {
  const answer = useRpc(answerDecision);
  return (
    <IconButton
      icon="Check"
      label={options.approveLabel}
      showLabel
      tone="accent"
      theme={theme}
      disabled={presses.busy}
      state={presses.stateOf("summary-approve")}
      onPress={() => presses.press("summary-approve", () => answer({ key: decision.key, label: options.approve, text: "", from: answeredFrom }), { after: "hold", onSuccess: onAnswered })}
    />
  );
}

/** One section: its row (icon, name, muted summary, chevron) and, when open, its body. */
function SectionRow({
  theme,
  icon,
  name,
  summary,
  expanded,
  stacked,
  last,
  onToggle,
  children,
}: {
  theme: PluginTheme;
  icon: string;
  name: string;
  summary: string;
  expanded: boolean;
  stacked: boolean;
  last: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { colors } = theme;
  const nameStyle = { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.8 };
  const summaryStyle = { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) };
  // The summary says what is folded; an open section shows it instead.
  const shownSummary = expanded || summary === "" ? null : summary;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, borderBottomWidth: last ? 1 : 0, borderBottomColor: colors.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ expanded }} onPress={onToggle} style={{ paddingVertical: SPACE.md, gap: SPACE.xxs }}>
        <View style={{ flexDirection: "row", alignItems: stacked || shownSummary === null ? "center" : "flex-start", gap: SPACE.sm }}>
          <View style={{ height: lineHeightFor(FONT_SIZE.small), justifyContent: "center" }}>
            <Icon name={icon} size={14} color={colors.foregroundMuted} />
          </View>
          <Text numberOfLines={1} style={[nameStyle, { lineHeight: lineHeightFor(FONT_SIZE.small) }, stacked ? { flex: 1 } : { width: NAME_COLUMN, flexShrink: 0 }]}>
            {name.toUpperCase()}
          </Text>
          {stacked ? null : (
            // minWidth 0: a clamped text's min-content is its whole length on the web, which would push the chevron out.
            <Text style={[summaryStyle, { flex: 1, minWidth: 0 }]} numberOfLines={2}>
              {shownSummary ?? ""}
            </Text>
          )}
          <View style={{ height: lineHeightFor(FONT_SIZE.small), justifyContent: "center", flexShrink: 0 }}>
            <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
          </View>
        </View>
        {stacked && shownSummary !== null ? (
          <Text style={[summaryStyle, { paddingLeft: 14 + SPACE.sm, minWidth: 0 }]} numberOfLines={2}>
            {shownSummary}
          </Text>
        ) : null}
      </Pressable>
      {children === null ? null : <View style={{ paddingBottom: SPACE.lg }}>{children}</View>}
    </View>
  );
}

/** FINAL in its fixed format (What changed, How it was verified, Limitations), or as Markdown when it has none. */
function ResultBody({ finalSummary, theme, onOpenLink }: { finalSummary: string; theme: PluginTheme; onOpenLink: (url: string) => void }) {
  const sections = useMemo(() => finalSections(finalSummary), [finalSummary]);
  if (sections === null) return <Markdown source={finalSummaryBody(finalSummary)} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={onOpenLink} foldParagraphs />;
  return <FinalBody sections={sections} theme={theme} onOpenLink={onOpenLink} />;
}

function FinalBody({ sections, theme, onOpenLink }: { sections: FinalSections; theme: PluginTheme; onOpenLink: (url: string) => void }) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const { colors } = theme;
  const heading = { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "700" as const };
  const text = { flex: 1, minWidth: 0, color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) };
  const marker = { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) };
  const more = { color: colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" as const, paddingVertical: SPACE.xxs };
  return (
    <View style={{ gap: SPACE.md }}>
      {FINAL_SECTIONS.map((template) => {
        const items = sections[template.key];
        if (items.length === 0) return null;
        const open = unfolded.has(template.key);
        // Past the template's limit the rest folds, as the plan's sections do.
        const { shown, hidden } = foldList(items, template.limit, open);
        return (
          <View key={template.key} style={{ gap: SPACE.xs }}>
            <Text accessibilityRole="header" style={heading}>
              {template.heading}
            </Text>
            {shown.map((item, index) => (
              <View key={`${index}:${item}`} style={{ flexDirection: "row", gap: SPACE.sm }}>
                <Text style={marker}>•</Text>
                <Text style={text}>
                  <MarkdownInline text={item} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={onOpenLink} />
                </Text>
              </View>
            ))}
            {items.length <= template.limit ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() =>
                  setUnfolded((current) => {
                    const next = new Set(current);
                    if (open) next.delete(template.key);
                    else next.add(template.key);
                    return next;
                  })
                }
              >
                <Text style={more}>{open ? "Show less" : `+${hidden} more`}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {sections.rest === "" ? null : <Markdown source={sections.rest} theme={theme} fontSize={FONT_SIZE.caption} onOpenLink={onOpenLink} foldParagraphs />}
    </View>
  );
}

/** The user's words first, as Markdown; the Manager's notes folded behind their count. */
function DescriptionBody({ description, theme, onOpenLink }: { description: string; theme: PluginTheme; onOpenLink: (url: string) => void }) {
  const parts = useMemo(() => descriptionParts(description), [description]);
  const [notesOpen, setNotesOpen] = useState(false);
  const { colors } = theme;
  return (
    <View style={{ gap: SPACE.md }}>
      {parts.userWords === "" ? null : <Markdown source={parts.userWords} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={onOpenLink} foldParagraphs />}
      {parts.managerNotes === null ? null : (
        <View style={{ gap: SPACE.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: notesOpen }}
            onPress={() => setNotesOpen((current) => !current)}
            style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, alignSelf: "flex-start" }}
          >
            <Icon name={notesOpen ? "ChevronDown" : "ChevronRight"} size={14} color={colors.foregroundMuted} />
            <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small, fontWeight: "600" }}>Manager notes ({parts.managerNoteCount})</Text>
          </Pressable>
          {notesOpen && parts.managerNotes !== "" ? <Markdown source={parts.managerNotes} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={onOpenLink} foldParagraphs /> : null}
        </View>
      )}
    </View>
  );
}

/**
 * The ticket's records, newest first, a line each on a rail: the time in its own column, a day
 * heading where the date changes, a small dot per record, coloured only for the records a reader
 * looks for. The newest few show, the rest behind "Show N older"; a tapped line shows all of it.
 */
function Timeline({ notes, theme, onOpenLink }: { notes: string | null; theme: PluginTheme; onOpenLink: (url: string) => void }) {
  const { colors } = theme;
  const milestones: readonly Milestone[] = useMemo(() => ticketMilestones(notes), [notes]);
  const [showAll, setShowAll] = useState(false);
  const { rows, older } = useMemo(() => recentMilestoneRows(milestones, showAll), [milestones, showAll]);
  // Keyed by the record, not the row: a newer record arriving (the list refetches) shifts every row down.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const line = withAlpha(colors.foregroundMuted, 0.35);
  const caption = { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.small) };

  function rail(first: boolean, last: boolean, dot: ReactNode) {
    return (
      <View style={{ width: RAIL, alignItems: "center" }}>
        {/* The rail joins the dots: it starts at the first and stops at the last. */}
        <View style={{ position: "absolute", left: RAIL / 2 - 1, top: first ? 8 : 0, bottom: last ? undefined : 0, height: last ? 8 : undefined, width: 2, backgroundColor: line }} />
        {dot}
      </View>
    );
  }

  const foldRow = older > 0 || showAll;
  return (
    <View>
      {rows.map((row, index) => {
        const color = row.key ? toneColor(theme, recordKindLook(row.kind).tone) : colors.foregroundMuted;
        const first = index === 0;
        const last = index === rows.length - 1 && !foldRow;
        const expanded = open.has(row.id);
        const toggle = () =>
          setOpen((current) => {
            const next = new Set(current);
            if (expanded) next.delete(row.id);
            else next.add(row.id);
            return next;
          });
        return (
          <View key={row.id}>
            {row.day === null ? null : (
              <View style={{ flexDirection: "row", gap: SPACE.sm }}>
                <View style={{ width: CLOCK }} />
                {rail(first, false, null)}
                <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.caption, fontWeight: "700", paddingTop: first ? 0 : SPACE.sm, paddingBottom: SPACE.sm }}>{row.day}</Text>
              </View>
            )}
            <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={toggle} style={{ flexDirection: "row", gap: SPACE.sm }}>
              <Text style={[caption, { width: CLOCK, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{row.clock ?? ""}</Text>
              {rail(
                first && row.day === null,
                last,
                <View
                  style={{
                    marginTop: 5,
                    width: DOT,
                    height: DOT,
                    borderRadius: DOT / 2,
                    borderWidth: 2,
                    borderColor: row.key ? color : colors.foregroundMuted,
                    backgroundColor: row.key ? color : colors.surface0,
                  }}
                />,
              )}
              <Text
                numberOfLines={expanded ? undefined : 1}
                style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : SPACE.sm, color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) }}
              >
                <Text style={{ color: row.key ? color : colors.foregroundMuted, fontWeight: "600" }}>{row.label}</Text>
                {row.text === "" ? null : (
                  <>
                    {"  "}
                    <MarkdownInline text={row.text} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={onOpenLink} />
                  </>
                )}
              </Text>
            </Pressable>
          </View>
        );
      })}
      {foldRow ? (
        <View style={{ flexDirection: "row", gap: SPACE.sm }}>
          <View style={{ width: CLOCK }} />
          {rail(false, true, null)}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAll }} onPress={() => setShowAll((current) => !current)} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
            <Icon name={showAll ? "ChevronUp" : "ChevronDown"} size={13} color={colors.accent} />
            <Text style={{ color: colors.accent, fontSize: FONT_SIZE.small, fontWeight: "600" }}>{showAll ? "Show fewer" : `Show ${older} older`}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
