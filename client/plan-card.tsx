/**
 * A scope approval as a compact plan card (TR-061, design B): the question, a tinted box of
 * labelled rows (Goal, the choices the user must check, Size) read from the ticket's plan, Approve
 * and View plan side by side, the other real options beside them. No field to describe a change
 * (TR-075): that is written under the full plan, where View plan leads. The plan comes from the
 * ticket (`loadTicket`, shared with the Ticket tab); while it loads, or when it does not follow the
 * template, the usual decision card shows. The full plan, with its sections
 * folded past their limits, is `PlanBody`, shown in the Ticket tab.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View, type TextInput as NativeTextInput } from "react-native";

import { answerDecision, loadTicket } from "../shared/contracts";
import { CHANGE_PLACEHOLDER, SCOPE_APPROVAL, planCardOptions, planChangeField, type PlanActionsPlace } from "../shared/decision-view";
import { parsePlan, splitChoice, type ParsedPlan, type PlanSection } from "../shared/plan";
import type { StoredDecision } from "../shared/state";
import { errorText } from "./format";
import { useRevealFocused } from "./keyboard";
import { Markdown, MarkdownInline } from "./markdown";
import { useViewPlan } from "./plan-navigation";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton } from "./ui";
import { useActions, type Actions } from "./use-actions";

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

/** The ticket's plan, parsed; null while it loads, without a ticket, or when it does not follow the template. */
export function useTicketPlan(project: string, ticket: string | null, enabled = true): ParsedPlan | null {
  const load = useRpc(loadTicket);
  const detail = useQuery({
    queryKey: ["taro", "ticket", project, ticket ?? ""],
    queryFn: () => load({ project, ticket: ticket ?? "" }),
    enabled: enabled && ticket !== null && project !== "",
    refetchInterval: 6_000,
  });
  const source = detail.data?.plan ?? null;
  return useMemo(() => parsePlan(source), [source]);
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
  onOpenHead = null,
  brief = false,
  answeredFrom = "screen",
  onAnswered,
  children,
}: {
  decision: StoredDecision;
  theme: PluginTheme;
  compact: boolean;
  /** The board's card: Goal, choices and Size clamped, each choice without its why. */
  brief?: boolean;
  /** The line above the question: who asked, or the ticket on the board. */
  head?: string | null;
  /** Opens what the head names (the ticket, on the board); the head is plain text without it. */
  onOpenHead?: (() => void) | null;
  answeredFrom?: "screen" | "tab";
  onAnswered: () => void;
  children: ReactNode;
}) {
  const options = useMemo(() => planCardOptions(decision), [decision]);
  const eligible = decision.id === SCOPE_APPROVAL && decision.ticket !== null && options !== null;
  const plan = useTicketPlan(decision.project, decision.ticket, eligible);
  if (!eligible || options === null || plan === null) return <>{children}</>;
  return <PlanCard decision={decision} plan={plan} options={options} theme={theme} compact={compact} head={head} onOpenHead={onOpenHead} brief={brief} answeredFrom={answeredFrom} onAnswered={onAnswered} />;
}

function PlanCard({
  decision,
  plan,
  options,
  theme,
  compact,
  head,
  onOpenHead,
  brief,
  answeredFrom,
  onAnswered,
}: {
  decision: StoredDecision;
  plan: ParsedPlan;
  options: PlanCardOptions;
  theme: PluginTheme;
  compact: boolean;
  head: string | null;
  onOpenHead: (() => void) | null;
  brief: boolean;
  answeredFrom: "screen" | "tab";
  onAnswered: () => void;
}) {
  const viewPlan = useViewPlan();
  // Outside the Taro screen there is no Ticket tab to open: the plan unfolds in the card instead.
  const [unfolded, setUnfolded] = useState(false);
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
      },
      head: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      headLink: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.xs },
      headLinkText: { flexShrink: 1 },
      waiting: { color: colors.statusWarning, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.5 },
      question: { color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const, lineHeight: lineHeightFor(FONT_SIZE.body) },
      titles: { gap: SPACE.xxs },
    }),
    [colors, compact, decision.blocking],
  );
  const ticket = decision.ticket ?? "";
  return (
    <View style={styles.card}>
      <View style={styles.titles}>
        {head === null ? null : onOpenHead === null ? (
          <Text style={styles.head} numberOfLines={1}>
            {head}
          </Text>
        ) : (
          <Pressable accessibilityRole="link" accessibilityLabel={`Open ${head}`} onPress={onOpenHead} style={styles.headLink}>
            <Text style={[styles.head, styles.headLinkText]} numberOfLines={1}>
              {head}
            </Text>
            <Icon name="ArrowRight" size={12} color={colors.foregroundMuted} />
          </Pressable>
        )}
        {decision.blocking ? <Text style={styles.waiting}>WAITING FOR YOU</Text> : null}
        <Text style={styles.question}>{decision.question}</Text>
      </View>
      {unfolded ? <PlanBody plan={plan} theme={theme} /> : <PlanSummary plan={plan} theme={theme} compact={compact} brief={brief} />}
      <PlanActions
        decision={decision}
        options={options}
        theme={theme}
        answeredFrom={answeredFrom}
        onAnswered={onAnswered}
        place={unfolded ? "unfolded card" : "card"}
        viewPlan={viewPlan === null ? { label: unfolded ? "Hide plan" : "View plan", onPress: () => setUnfolded((open) => !open) } : { label: "View plan", onPress: () => viewPlan(decision.project, ticket) }}
      />
    </View>
  );
}

/** Goal, the choices and Size as labelled rows in a tinted box; labels above their text where the box is narrow. */
function PlanSummary({ plan, theme, compact, brief }: { plan: ParsedPlan; theme: PluginTheme; compact: boolean; brief: boolean }) {
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
    }),
    [colors, stacked],
  );
  const shownChoices = plan.choices.slice(0, 4);
  const rows: { label: string; content: ReactNode }[] = [];
  rows.push({
    label: "GOAL",
    content: (
      <Text style={styles.goal} numberOfLines={brief ? BRIEF_LINES.goal : undefined}>
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
              <Text style={styles.marker}>•</Text>
              <Text style={[styles.text, styles.bulletText]} numberOfLines={brief ? BRIEF_LINES.choice : undefined}>
                <MarkdownInline text={choice.choice} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
                {brief || choice.why === "" ? null : (
                  <Text style={styles.muted}>
                    {" — "}
                    <MarkdownInline text={choice.why} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
                  </Text>
                )}
              </Text>
            </View>
          ))}
          {plan.choices.length > shownChoices.length ? <Text style={styles.more}>+{plan.choices.length - shownChoices.length} more in the plan</Text> : null}
        </>
      ),
    });
  }
  if (plan.size !== "") {
    rows.push({
      label: "SIZE",
      content: (
        <Text style={[styles.text, styles.muted]} numberOfLines={brief ? BRIEF_LINES.size : undefined}>
          <MarkdownInline text={plan.size} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
        </Text>
      ),
    });
  }
  return (
    <View style={styles.box} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {rows.map((row, index) => (
        <View key={row.label} style={[styles.row, index === 0 ? null : styles.divider]}>
          <Text style={styles.label}>{row.label}</Text>
          <View style={styles.content}>{row.content}</View>
        </View>
      ))}
    </View>
  );
}

/**
 * Approve (it sends the approve option, with any typed words), View plan when given, the other real
 * options, then, under the full plan only, the field: Send appears once there is text and sends the
 * words alone.
 */
export function PlanActions({
  decision,
  options,
  theme,
  answeredFrom,
  onAnswered,
  viewPlan = null,
  place = "ticket plan",
  presses: sharedPresses = null,
}: {
  decision: StoredDecision;
  options: PlanCardOptions;
  theme: PluginTheme;
  answeredFrom: "screen" | "tab";
  onAnswered: () => void;
  viewPlan?: { label: string; onPress: () => void } | null;
  /** Where the buttons are: the field comes only under the full plan. */
  place?: PlanActionsPlace;
  /** The presses of another Approve for the same decision on the screen, so only one runs at a time. */
  presses?: Actions | null;
}) {
  const answer = useRpc(answerDecision);
  const ownPresses = useActions();
  const presses = sharedPresses ?? ownPresses;
  const [typed, setTyped] = useState("");
  const field = useRef<NativeTextInput>(null);
  // The field is the card's last row: revealed with it, Send stays above the keyboard.
  const fieldRow = useRef<View>(null);
  const reveal = useRevealFocused(fieldRow);
  const withField = planChangeField(place);
  const words = withField ? typed.trim() : "";
  const busy = presses.busy;
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const narrow = rowWidth !== null && rowWidth < NARROW_ROW_WIDTH;
  const icon = (name: string) => (narrow ? null : name);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      group: { gap: SPACE.sm },
      buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm },
      // Equal shares of the row, each button filling its share, so siblings match in size.
      slot: { flexGrow: 1, flexBasis: 0, minWidth: narrow ? NARROW_BUTTON_MIN_WIDTH : BUTTON_MIN_WIDTH },
      fieldRow: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: SPACE.sm },
      input: {
        flex: 1,
        color: colors.foreground,
        fontSize: FONT_SIZE.small,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: SPACE.sm,
        minHeight: 38,
        backgroundColor: colors.surface0,
      },
    }),
    [colors, narrow],
  );

  function send(key: string, label: string | null, asksForWords = false): void {
    // An option that asks for words waits for them.
    if (asksForWords && words === "") {
      // Without a field here, the words are typed under the plan View plan opens.
      if (withField) field.current?.focus();
      else viewPlan?.onPress();
      return;
    }
    // The answered decision leaves, so the pressed button stays busy until it does.
    presses.press(key, () => answer({ key: decision.key, label, text: words, from: answeredFrom }), {
      after: "hold",
      onSuccess: () => {
        setTyped("");
        onAnswered();
      },
    });
  }

  return (
    <View style={styles.group}>
      <View style={styles.buttons} onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
        <View style={styles.slot}>
          <IconButton icon={icon("Check")} label={options.approveLabel} showLabel tone="accent" theme={theme} disabled={busy} state={presses.stateOf("approve")} onPress={() => send("approve", options.approve)} />
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
              state={presses.stateOf(`option:${other.label}`)}
              onPress={() => send(`option:${other.label}`, other.label, other.asksForWords)}
            />
          </View>
        ))}
      </View>
      {withField ? (
        <View ref={fieldRow} collapsable={false} style={styles.fieldRow}>
          <TextInput
            ref={field}
            value={typed}
            onChangeText={setTyped}
            onFocus={reveal}
            placeholder={CHANGE_PLACEHOLDER}
            placeholderTextColor={colors.foregroundMuted}
            multiline
            editable={!busy}
            style={styles.input}
          />
          {words === "" ? null : <IconButton icon="Send" label="Send" showLabel theme={theme} disabled={busy} state={presses.stateOf("send")} onPress={() => send("send", null)} />}
        </View>
      ) : null}
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
export function PlanBody({ plan, theme, proof = null }: { plan: ParsedPlan; theme: PluginTheme; proof?: ReactNode }) {
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
    }),
    [colors],
  );
  const inline = (text: string) => <MarkdownInline text={text} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />;

  function bulletText(section: PlanSection, item: string): ReactNode {
    if (section.key !== "choices") return inline(item);
    const choice = splitChoice(item);
    if (choice.why === "") return inline(item);
    return (
      <>
        {inline(choice.choice)}
        <Text style={styles.muted}>
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
      {plan.sections.map((section, sectionIndex) => {
        const open = unfolded.has(sectionIndex);
        // Goal and Size are lines: a long one is shown whole, and the template's limit is the owner's to keep.
        const foldable = section.limit !== null && section.key !== "goal" && section.key !== "size" && section.items.length > section.limit;
        const shown = foldable && !open ? section.items.slice(0, section.limit ?? undefined) : section.items;
        return (
          <View key={`${sectionIndex}:${section.heading}`} style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>
              {section.heading}
            </Text>
            {section.prose === "" ? null : <Markdown source={section.prose} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />}
            {shown.map((item, index) => (
              <View key={`${index}:${item}`} style={styles.bullet}>
                <Text style={styles.marker}>•</Text>
                <Text style={[styles.text, styles.bulletText]}>{bulletText(section, item)}</Text>
              </View>
            ))}
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
