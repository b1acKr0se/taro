/**
 * A scope approval as a compact plan card (TR-061, design B): the question, a tinted box of
 * labelled rows (Goal, the choices the user must check, Size) read from the ticket's plan, then
 * Approve, Request changes… and View plan side by side, the other real options beside them; Request
 * changes… opens the change box in place of the buttons, as on the acceptance card (TR-112). The plan comes from the
 * ticket (`loadTicket`, shared with the Ticket tab); while it loads, or when it does not follow the
 * template, the usual decision card shows. The full plan, with its sections
 * folded past their limits, is `PlanBody`, shown in the Ticket tab. Given `onOpen`, the whole card opens
 * the ticket's chat, where it lands on the plan's message, as the other cards that wait for the user do (TR-126).
 * A plan asked again shows what is new or changed since the plan the user last answered in green, under a
 * caption saying so (TR-151), on the card and in `PlanBody`.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { answerDecision, loadTicket, type TicketDetailView } from "../shared/contracts";
import { SCOPE_APPROVAL, planCardOptions, planChangeBox, type PlanActionsPlace } from "../shared/decision-view";
import { parsePlan, splitChoice, type ParsedPlan, type PlanSection } from "../shared/plan";
import { noPlanChanges, planChanges, planChangesCaption, type PlanChanges } from "../shared/plan-changes";
import type { StoredDecision } from "../shared/state";
import { ChangeBox } from "./change-box";
import { Pressable } from "./focus";
import { errorText, formatClock, formatDay } from "./format";
import { useRevealFocused } from "./keyboard";
import { Markdown, MarkdownInline } from "./markdown";
import { deliveryRecords, type DeliveryRecord } from "./finished-cards";
import { planAnswers, type PlanAnswer } from "./plan-lines";
import { useViewPlan } from "./plan-navigation";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton } from "./ui";
import { decisionCall, optionPress } from "./shared-presses";
import { useActions, type Actions } from "./use-actions";
import { polled } from "./polling";

/** Below this width the box's labels sit above their text instead of in a column beside it. */
const STACK_BELOW_WIDTH = 460;
const LABEL_COLUMN = 84;
/** On the board the card stays short (a 240 px column): Goal, each choice and Size clamp to these lines, and View plan has the rest. */
const BRIEF_LINES = { goal: 3, choice: 2, size: 1 } as const;
/** The narrowest a button of the action row gets before the row wraps; in a narrow row (a board column) without icons. */
const BUTTON_MIN_WIDTH = 120;
const NARROW_BUTTON_MIN_WIDTH = 80;
/** Below this the row's buttons drop their icons, so Approve and View plan stay side by side. */
const NARROW_ROW_WIDTH = 2 * BUTTON_MIN_WIDTH + SPACE.sm;

export type PlanCardOptions = NonNullable<ReturnType<typeof planCardOptions>>;

/** The ticket, shared with the Ticket tab; undefined while it loads or without a ticket. */
function useTicketDetail(project: string, ticket: string | null, enabled: boolean) {
  const load = useRpc(loadTicket);
  return useQuery({
    queryKey: ["taro", "ticket", project, ticket ?? ""],
    queryFn: () => load({ project, ticket: ticket ?? "" }),
    enabled: enabled && ticket !== null && project !== "",
    ...polled(6_000),
  }).data;
}

/** The ticket's plan, parsed; null while it loads, without a ticket, or when it does not follow the template. */
export function useTicketPlan(project: string, ticket: string | null, enabled = true): ParsedPlan | null {
  const source = useTicketDetail(project, ticket, enabled)?.plan ?? null;
  return useMemo(() => parsePlan(source), [source]);
}

/** What the plan marks green, and the caption saying since when; null caption when nothing changed. */
export interface PlanMarks {
  changes: PlanChanges;
  caption: string | null;
}

/** The marks of `plan` against the plan the user last answered (TR-151); none for a first plan. */
export function usePlanMarks(plan: ParsedPlan | null, previous: TicketDetailView["previousPlan"] | undefined): PlanMarks | null {
  const previousSource = previous?.plan ?? null;
  const at = previous?.at ?? null;
  const kind = previous?.kind ?? null;
  return useMemo(() => {
    if (plan === null) return null;
    const changes = previousSource === null ? noPlanChanges(plan) : planChanges(parsePlan(previousSource), plan);
    return { changes, caption: changes.any && kind !== null ? planChangesCaption(kind, formatClock(at), formatDay(at)) : null };
  }, [plan, previousSource, at, kind]);
}

/** What the ticket's notes say of finished cards (TR-135, TR-149): plan answers and acceptance records. */
export interface TicketRecords {
  plans: readonly PlanAnswer[];
  deliveries: readonly DeliveryRecord[];
}

/** The ticket's records, for the finished cards in the owner's chat; null while it loads. */
export function useTicketRecords(project: string, ticket: string): TicketRecords | null {
  const detail = useTicketDetail(project, ticket, true);
  const notes = detail === undefined ? undefined : detail.notes;
  return useMemo(() => (notes === undefined ? null : { plans: planAnswers(notes), deliveries: deliveryRecords(notes) }), [notes]);
}

/**
 * The plan card for a scope approval whose ticket has a template plan and something for Approve to
 * send; `children` (the usual card) otherwise, and while the plan loads.
 */
export function PlanDecision({
  decision,
  theme,
  compact,
  head = null,
  onOpen = null,
  brief = false,
  answeredFrom = "screen",
  onAnswered,
  fill = false,
  children,
}: {
  decision: StoredDecision;
  theme: PluginTheme;
  compact: boolean;
  /** The board's card: Goal, choices and Size clamped, each choice without its why. */
  brief?: boolean;
  /** The line above the question: who asked, or the ticket on the board. */
  head?: string | null;
  /** Opens the ticket's chat from anywhere on the card outside its buttons; the card is not pressable without it. */
  onOpen?: (() => void) | null;
  answeredFrom?: "screen" | "tab";
  onAnswered: () => void;
  /** Grows to its grid row's height, its buttons at the bottom (TR-105). */
  fill?: boolean;
  children: ReactNode;
}) {
  const options = useMemo(() => planCardOptions(decision), [decision]);
  const eligible = decision.id === SCOPE_APPROVAL && decision.ticket !== null && options !== null;
  const detail = useTicketDetail(decision.project, decision.ticket, eligible);
  const source = detail?.plan ?? null;
  const plan = useMemo(() => parsePlan(source), [source]);
  const marks = usePlanMarks(plan, detail?.previousPlan);
  if (!eligible || options === null || plan === null || marks === null) return <>{children}</>;
  return <PlanCard decision={decision} plan={plan} marks={marks} options={options} theme={theme} compact={compact} head={head} onOpen={onOpen} brief={brief} answeredFrom={answeredFrom} onAnswered={onAnswered} fill={fill} />;
}

function PlanCard({
  decision,
  plan,
  marks,
  options,
  theme,
  compact,
  head,
  onOpen,
  brief,
  answeredFrom,
  onAnswered,
  fill,
}: {
  decision: StoredDecision;
  plan: ParsedPlan;
  marks: PlanMarks;
  options: PlanCardOptions;
  theme: PluginTheme;
  compact: boolean;
  head: string | null;
  onOpen: (() => void) | null;
  brief: boolean;
  answeredFrom: "screen" | "tab";
  onAnswered: () => void;
  fill: boolean;
}) {
  const viewPlan = useViewPlan();
  // Outside the Taro screen there is no Ticket tab to open: the plan unfolds in the card instead.
  const [unfolded, setUnfolded] = useState(false);
  // While the change box is open a click in its field must not leave for the chat; the card stays enabled, as
  // a disabled one marks everything inside it disabled (aria-disabled) on the web, the box's buttons included.
  const [writing, setWriting] = useState(false);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: decision.blocking ? colors.statusWarning : colors.border,
        borderRadius: 10,
        padding: compact ? SPACE.md : SPACE.lg,
        gap: SPACE.md,
        backgroundColor: colors.surface1,
        ...(fill ? { flexGrow: 1 } : {}),
      },
      head: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      headRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.xs },
      headText: { flexShrink: 1 },
      question: { color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const, lineHeight: lineHeightFor(FONT_SIZE.body) },
      titles: { gap: SPACE.xxs },
      // In a grid row the buttons sit at the bottom, level with the cards beside it (TR-105).
      buttons: fill ? { flexGrow: 1, justifyContent: "flex-end" as const } : {},
    }),
    [colors, compact, decision.blocking, fill],
  );
  const ticket = decision.ticket ?? "";
  const titles = (
    <View style={styles.titles}>
      {head === null ? null : (
        <View style={styles.headRow}>
          <Text style={[styles.head, styles.headText]} numberOfLines={1}>
            {head}
          </Text>
          {onOpen === null ? null : <Icon name="ArrowRight" size={12} color={colors.foregroundMuted} />}
        </View>
      )}
      <Text style={styles.question}>{decision.question}</Text>
    </View>
  );
  const body = (
    <>
      {titles}
      {unfolded ? <PlanBody plan={plan} marks={marks} theme={theme} /> : <PlanSummary plan={plan} marks={marks} theme={theme} compact={compact} brief={brief} />}
      <View style={styles.buttons}>
        <PlanActions
          decision={decision}
          options={options}
          theme={theme}
          compact={compact}
          answeredFrom={answeredFrom}
          onAnswered={onAnswered}
          place={unfolded ? "unfolded card" : "card"}
          onWriting={setWriting}
          viewPlan={viewPlan === null ? { label: unfolded ? "Hide plan" : "View plan", onPress: () => setUnfolded((open) => !open) } : { label: "View plan", onPress: () => viewPlan(decision.project, ticket) }}
        />
      </View>
    </>
  );
  if (onOpen === null) return <View style={styles.card}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${head ?? ticket} asks: ${decision.question}`} onPress={writing ? undefined : onOpen} style={styles.card}>
      {body}
    </Pressable>
  );
}

/** The line above a plan with changes saying what its green means (TR-151). */
function ChangesCaption({ caption, theme, lines }: { caption: string | null; theme: PluginTheme; lines?: number | undefined }) {
  if (caption === null) return null;
  return (
    <Text style={{ color: theme.colors.statusSuccess, fontSize: FONT_SIZE.caption, fontWeight: "600" }} numberOfLines={lines}>
      {caption}
    </Text>
  );
}

/** Goal, the choices and Size as labelled rows in a tinted box; labels above their text where the box is narrow. */
function PlanSummary({ plan, marks, theme, compact, brief }: { plan: ParsedPlan; marks: PlanMarks; theme: PluginTheme; compact: boolean; brief: boolean }) {
  const [width, setWidth] = useState<number | null>(null);
  const stacked = width === null ? compact : width < STACK_BELOW_WIDTH;
  const openLink = useOpenLink();
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      box: { borderRadius: 8, backgroundColor: colors.surface2, overflow: "hidden" as const },
      row: { flexDirection: stacked ? ("column" as const) : ("row" as const), gap: stacked ? SPACE.xxs : SPACE.md, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm + 2 },
      // The theme's border is lost on the box's tint; a faint muted line separates the rows.
      divider: { borderTopWidth: 1, borderTopColor: withAlpha(colors.foregroundMuted, 0.18) },
      label: {
        width: stacked ? undefined : LABEL_COLUMN,
        color: colors.foregroundMuted,
        fontSize: FONT_SIZE.micro,
        fontWeight: "700" as const,
        letterSpacing: 0.8,
        // Level with the first line of the text beside it.
        lineHeight: stacked ? undefined : lineHeightFor(FONT_SIZE.small),
      },
      content: { flex: stacked ? undefined : 1, minWidth: 0, gap: SPACE.xxs },
      goal: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "700" as const, lineHeight: lineHeightFor(FONT_SIZE.small) },
      text: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      muted: { color: colors.foregroundMuted },
      bullet: { flexDirection: "row" as const, gap: SPACE.sm },
      marker: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      bulletText: { flex: 1, minWidth: 0 },
      more: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      changed: { color: colors.statusSuccess },
      outer: { gap: SPACE.sm },
    }),
    [colors, stacked],
  );
  const { changes } = marks;
  const shownChoices = plan.choices.slice(0, 4);
  const hiddenNew = changes.choices.slice(shownChoices.length).filter(Boolean).length;
  const rows: { label: string; content: ReactNode }[] = [];
  rows.push({
    label: "GOAL",
    content: (
      <Text style={[styles.goal, changes.goal ? styles.changed : null]} numberOfLines={brief ? BRIEF_LINES.goal : undefined}>
        <MarkdownInline text={plan.goal} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
      </Text>
    ),
  });
  if (plan.choices.length > 0) {
    rows.push({
      label: "CHOICES",
      content: (
        <>
          {shownChoices.map((choice, index) => (
            <View key={`${index}:${choice.choice}`} style={styles.bullet}>
              <Text style={[styles.marker, changes.choices[index] === true ? styles.changed : null]}>•</Text>
              <Text style={[styles.text, styles.bulletText, changes.choices[index] === true ? styles.changed : null]} numberOfLines={brief ? BRIEF_LINES.choice : undefined}>
                <MarkdownInline text={choice.choice} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
                {brief || choice.why === "" ? null : (
                  <Text style={changes.choices[index] === true ? null : styles.muted}>
                    {" — "}
                    <MarkdownInline text={choice.why} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
                  </Text>
                )}
              </Text>
            </View>
          ))}
          {plan.choices.length > shownChoices.length ? (
            <Text style={styles.more}>
              +{plan.choices.length - shownChoices.length} more in the plan
              {hiddenNew === 0 ? null : <Text style={styles.changed}>{` (${hiddenNew} new or changed)`}</Text>}
            </Text>
          ) : null}
        </>
      ),
    });
  }
  if (plan.size !== "") {
    rows.push({
      label: "SIZE",
      content: (
        <Text style={[styles.text, changes.size ? styles.changed : styles.muted]} numberOfLines={brief ? BRIEF_LINES.size : undefined}>
          <MarkdownInline text={plan.size} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
        </Text>
      ),
    });
  }
  return (
    <View style={styles.outer}>
      <ChangesCaption caption={marks.caption} theme={theme} lines={brief ? 3 : undefined} />
      <View style={styles.box} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {rows.map((row, index) => (
          <View key={row.label} style={[styles.row, index === 0 ? null : styles.divider]}>
            <Text style={styles.label}>{row.label}</Text>
            <View style={styles.content}>{row.content}</View>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The plan's buttons, asking as the acceptance card does (TR-112): Approve and Request changes…, View
 * plan when given, and the other real options. Request changes…, or an option that asks for words,
 * swaps the row for the change box with Send changes and Cancel.
 */
export function PlanActions({
  decision,
  options,
  theme,
  compact,
  answeredFrom,
  onAnswered,
  viewPlan = null,
  place = "ticket plan",
  presses: sharedPresses = null,
  onWriting,
}: {
  decision: StoredDecision;
  options: PlanCardOptions;
  theme: PluginTheme;
  compact?: boolean;
  answeredFrom: "screen" | "tab";
  onAnswered: () => void;
  viewPlan?: { label: string; onPress: () => void } | null;
  /** Where the buttons are, for the box's fill. */
  place?: PlanActionsPlace;
  /** The presses of another Approve for the same decision on the screen, so only one runs at a time. */
  presses?: Actions | null;
  /** Told when the change box opens or closes. */
  onWriting?: (open: boolean) => void;
}) {
  const answer = useRpc(answerDecision);
  // Shared with the same decision's buttons on every other surface (TR-191).
  const ownPresses = useActions(decisionCall(decision));
  const presses = sharedPresses ?? ownPresses;
  const [typed, setTyped] = useState("");
  // The option the box is open for: null for Request changes…, undefined while the buttons show.
  const [writing, setWritingState] = useState<string | null | undefined>(undefined);
  const setWriting = (value: string | null | undefined) => {
    setWritingState(value);
    onWriting?.(value !== undefined);
  };
  // The box and the buttons under it are revealed together, so Send changes stays above the keyboard.
  const foot = useRef<View>(null);
  const reveal = useRevealFocused(foot);
  const busy = presses.busy;
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const narrow = rowWidth !== null && rowWidth < NARROW_ROW_WIDTH;
  const icon = (name: string) => (narrow ? null : name);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm },
      // Each button as wide as its label, sharing the spare width, so a label stays on one line: an equal
      // share broke Request changes… over two lines beside Approve (TR-112). Siblings keep one height.
      slot: { flexGrow: 1, flexBasis: "auto" as const, minWidth: narrow ? NARROW_BUTTON_MIN_WIDTH : BUTTON_MIN_WIDTH },
    }),
    [narrow],
  );

  function send(key: string, label: string | null, text: string): void {
    // The answered decision leaves, so the pressed button stays busy until it does.
    presses.press(key, () => answer({ key: decision.key, label, text, from: answeredFrom }), {
      after: "hold",
      onSuccess: () => {
        setTyped("");
        setWriting(undefined);
        onAnswered();
      },
    });
  }

  if (writing !== undefined) {
    const box = planChangeBox(writing, typed);
    return (
      <View ref={foot} collapsable={false}>
        <ChangeBox
          theme={theme}
          compact={compact}
          value={typed}
          onChangeText={setTyped}
          onFocus={reveal}
          placeholder={box.placeholder}
          sendLabel={box.sendLabel}
          canSend={box.enabled}
          busy={busy}
          sendState={presses.stateOf("change")}
          onSend={() => send("change", box.label, box.text)}
          onCancel={() => setWriting(undefined)}
          // The cards are surface1 themselves; the Ticket view's Plan sits on the pane.
          background={place === "ticket plan" ? undefined : colors.surface0}
        />
      </View>
    );
  }
  return (
    <View style={styles.buttons} onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
      <View style={styles.slot}>
        <IconButton
          icon={icon("Check")}
          label={options.approveLabel}
          showLabel
          tone="accent"
          theme={theme}
          disabled={busy}
          state={presses.stateOf(optionPress(options.approve))}
          onPress={() => send(optionPress(options.approve), options.approve, "")}
        />
      </View>
      <View style={styles.slot}>
        <IconButton icon={icon("MessageSquare")} label="Request changes…" showLabel theme={theme} disabled={busy} onPress={() => setWriting(null)} />
      </View>
      {viewPlan === null ? null : (
        <View style={styles.slot}>
          <IconButton icon={icon("FileText")} label={viewPlan.label} showLabel theme={theme} onPress={viewPlan.onPress} />
        </View>
      )}
      {options.others.map((other) => (
        <View key={other.label} style={styles.slot}>
          <IconButton
            icon={icon("CornerDownRight")}
            label={other.label}
            showLabel
            theme={theme}
            disabled={busy}
            state={presses.stateOf(optionPress(other.label))}
            onPress={() => (other.asksForWords ? setWriting(other.label) : send(optionPress(other.label), other.label, ""))}
          />
        </View>
      ))}
    </View>
  );
}

function useOpenLink(): (url: string) => void {
  const toast = useToast();
  return (url) => void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
}

/**
 * The whole plan, section by section in template order: a small bold heading, its bullets (a
 * choice's why muted), and a "+N more" fold past the section's limit. `proof` goes under How I'll
 * prove it (an older ticket's criteria), in a section of its own when the plan has none.
 */
export function PlanBody({ plan, marks = null, theme, proof = null }: { plan: ParsedPlan; marks?: PlanMarks | null; theme: PluginTheme; proof?: ReactNode }) {
  const openLink = useOpenLink();
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set());
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      body: { gap: SPACE.md },
      section: { gap: SPACE.xs },
      heading: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "700" as const },
      text: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      muted: { color: colors.foregroundMuted },
      bullet: { flexDirection: "row" as const, gap: SPACE.sm },
      marker: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      bulletText: { flex: 1, minWidth: 0 },
      more: { color: colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" as const, paddingVertical: SPACE.xxs },
      changed: { color: colors.statusSuccess },
      // Markdown keeps its own text colour: changed prose of more than one line gets a green rule beside it.
      changedBlock: { borderLeftWidth: 2, borderLeftColor: colors.statusSuccess, paddingLeft: SPACE.sm },
    }),
    [colors],
  );
  const inline = (text: string) => <MarkdownInline text={text} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />;

  function bulletText(section: PlanSection, item: string, changed: boolean): ReactNode {
    if (section.key !== "choices") return inline(item);
    const choice = splitChoice(item);
    if (choice.why === "") return inline(item);
    return (
      <>
        {inline(choice.choice)}
        {/* inherits colour: inside the bullet's Text, green when changed */}
        <Text style={changed ? null : styles.muted}>
          {" — "}
          {inline(choice.why)}
        </Text>
      </>
    );
  }

  function toggle(sectionIndex: number): void {
    setUnfolded((current) => {
      const next = new Set(current);
      if (next.has(sectionIndex)) next.delete(sectionIndex);
      else next.add(sectionIndex);
      return next;
    });
  }

  const hasProof = plan.sections.some((section) => section.key === "proof");
  return (
    <View style={styles.body}>
      {plan.intro === "" ? null : <Markdown source={plan.intro} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />}
      <ChangesCaption caption={marks?.caption ?? null} theme={theme} />
      {plan.sections.map((section, sectionIndex) => {
        const open = unfolded.has(sectionIndex);
        const changes = marks?.changes.sections[sectionIndex];
        // Goal and Size are lines: a long one is shown whole, and the template's limit is the owner's to keep.
        const foldable = section.limit !== null && section.key !== "goal" && section.key !== "size" && section.items.length > section.limit;
        const shown = foldable && !open ? section.items.slice(0, section.limit ?? undefined) : section.items;
        return (
          <View key={`${sectionIndex}:${section.heading}`} style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>
              {section.heading}
            </Text>
            {section.prose === "" ? null : changes?.prose === true && !section.prose.includes("\n") ? (
              <Text style={[styles.text, styles.changed]}>{inline(section.prose)}</Text>
            ) : changes?.prose === true ? (
              <View style={styles.changedBlock}>
                <Markdown source={section.prose} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
              </View>
            ) : (
              <Markdown source={section.prose} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
            )}
            {shown.map((item, index) => {
              const changed = changes?.items[index] === true;
              return (
                <View key={`${index}:${item}`} style={styles.bullet}>
                  <Text style={[styles.marker, changed ? styles.changed : null]}>•</Text>
                  <Text style={[styles.text, styles.bulletText, changed ? styles.changed : null]}>{bulletText(section, item, changed)}</Text>
                </View>
              );
            })}
            {foldable ? (
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => toggle(sectionIndex)}>
                <Text style={styles.more}>{open ? "Show less" : `+${section.items.length - shown.length} more`}</Text>
              </Pressable>
            ) : null}
            {section.key === "proof" ? proof : null}
          </View>
        );
      })}
      {proof === null || hasProof ? null : (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>
            How I’ll prove it
          </Text>
          {proof}
        </View>
      )}
    </View>
  );
}
