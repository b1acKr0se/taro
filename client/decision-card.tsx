/**
 * One decision an agent asked (decision 28): the question, why it matters,
 * the options as a light radio list (label, then a muted description; the
 * recommended one tagged with its reason), the default for a non-blocking
 * decision, then Other, the reply box and Dismiss / Submit. TR-030: the
 * side-by-side option boxes broke on long text and phones; the list follows
 * Claude Code's question prompt. TR-083: Submit sends the picked option alone,
 * or with words when it ends with "…" (TR-028); the box is greyed, keeping what
 * was typed, until Other or such an option is picked. TR-055: an option's images sit under it, captioned, and open in a
 * viewer of that option's images alone, its label in the bar. TR-061: options that only stand for
 * typing ("Change…", "Other") are hidden, the field says it takes a change on an approval, and a scope
 * approval with a template plan is the compact plan card (`./plan-card`).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import { answerDecision } from "../shared/contracts";
import { ANSWER_PLACEHOLDER, answerPlaceholder, askedBy, decisionOptionRows, decisionSubmit, type DecisionOptionRow, type DecisionPick } from "../shared/decision-view";
import { questionsOf } from "../shared/reports";
import { allAnswered, answeredFlags, draftAnswers, freshDrafts, recapLine, type QuestionDraft } from "../shared/several-questions";
import type { StoredDecision } from "../shared/state";
import { Pressable } from "./focus";
import { useRevealFocused } from "./keyboard";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { ImageThumbnail } from "./image-view";
import { PlanDecision } from "./plan-card";
import { useSeveralDrafts } from "./several-drafts";
import { ReplyBox } from "./reply-box";
import { IconButton } from "./ui";
import { decisionCall, optionPress } from "./shared-presses";
import { useActions } from "./use-actions";

/** The height of an option's thumbnails; a phone shot is half as wide, a desktop one 1.6 times. */
const OPTION_IMAGE_HEIGHT = 96;
const RADIO_SIZE = 18;

/** A "why" longer than this folds to four lines behind "more". */
const WHY_FOLD_CHARACTERS = 220;

interface DecisionCardProps {
  decision: StoredDecision;
  theme: PluginTheme;
  compact: boolean;
  onAnswered: () => void;
  /** Names who asked (in the Inbox and Walk me through). */
  showAgent?: boolean;
  /** Where the card is, for the ANSWER record. */
  answeredFrom?: "screen" | "tab";
  /** Set when the card cannot be answered: the options are inert and this replaces the answer box. */
  readOnlyNote?: string | null;
}

/** A scope approval with a template plan is the compact plan card (TR-061); any other decision, or one that cannot be answered, the options card. */
export function DecisionCard(props: DecisionCardProps) {
  // Several questions are never a plan: scope-approval stays a single question (TR-207).
  if (questionsOf(props.decision).length > 1) return <SeveralCard {...props} />;
  if (props.readOnlyNote !== undefined && props.readOnlyNote !== null) return <OptionsCard {...props} />;
  return (
    <PlanDecision
      decision={props.decision}
      theme={props.theme}
      compact={props.compact}
      head={props.showAgent === true ? askedBy(props.decision) : null}
      answeredFrom={props.answeredFrom ?? "screen"}
      onAnswered={props.onAnswered}
    >
      <OptionsCard {...props} />
    </PlanDecision>
  );
}

function OptionsCard({ decision, theme, compact, onAnswered, showAgent = false, answeredFrom = "screen", readOnlyNote = null }: DecisionCardProps) {
  // The box and Dismiss are revealed together, so both stay above the keyboard while the reader types.
  const actions = useRef<View>(null);
  const reveal = useRevealFocused(actions);
  const answer = useRpc(answerDecision);
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<DecisionPick>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  // Shared with the same decision's chips and buttons on every other surface (TR-191).
  const presses = useActions(decisionCall(decision));
  const busy = presses.busy;
  const { colors } = theme;
  const optionRows = useMemo(() => decisionOptionRows(decision), [decision]);
  const submit = decisionSubmit(optionRows.rows, picked, typed, answerPlaceholder(decision));
  // The picked option's press key, so its chip on the Needs you card spins while this sends.
  const submitPress = submit.label === null ? "submit" : optionPress(submit.label);
  const answerable = readOnlyNote === null;
  // A card that cannot be answered does not ask for the user.
  const waiting = decision.blocking && answerable;
  const styles = useCardStyles(theme, compact, waiting);

  return (
    <View style={styles.card}>
      {showAgent ? <Text style={styles.who}>{askedBy(decision)}</Text> : null}
      <Text style={styles.question}>{decision.question}</Text>
      {decision.why === "" ? null : (
        <Pressable onPress={() => setWhyOpen((open) => !open)} disabled={decision.why.length < WHY_FOLD_CHARACTERS}>
          <Text style={styles.why} numberOfLines={whyOpen ? undefined : 4}>
            {decision.why}
          </Text>
          {decision.why.length < WHY_FOLD_CHARACTERS ? null : <Text style={styles.more}>{whyOpen ? "less" : "more"}</Text>}
        </Pressable>
      )}
      <OptionRadios rows={optionRows.rows} picked={picked} onPick={setPicked} busy={busy} answerable={answerable} styles={styles} theme={theme} compact={compact} />
      {optionRows.looseReason === "" ? null : <Text style={styles.reason}>Why recommended: {optionRows.looseReason}</Text>}
      {!decision.blocking && answerable && decision.default !== "" ? <Text style={styles.defaultNote}>Going with “{decision.default}” unless you say otherwise.</Text> : null}
      {decision.problems.length > 0 ? <Text style={styles.problems}>Incomplete block: {decision.problems.join("; ")}</Text> : null}
      {!answerable ? (
        <Text style={styles.defaultNote}>{readOnlyNote}</Text>
      ) : (
        <View ref={actions} collapsable={false} style={styles.answer}>
          <ReplyBox
            theme={theme}
            compact={compact}
            value={typed}
            onChangeText={setTyped}
            onFocus={reveal}
            placeholder={submit.placeholder}
            background={colors.surface0}
            editable={!busy}
            greyed={!submit.fieldEnabled}
            onPressGreyed={busy ? undefined : () => setPicked("other")}
          />
          <View style={styles.actions}>
            <IconButton icon="X" label="Dismiss" showLabel theme={theme} disabled={busy || picked === null} onPress={() => setPicked(null)} />
            <IconButton
              icon="Check"
              label="Submit"
              showLabel
              tone="accent"
              theme={theme}
              disabled={busy || !submit.enabled}
              // Busy too while another surface answers this decision, as nothing is picked here to spin instead.
              state={presses.stateOf(submitPress) ?? (busy ? "busy" : undefined)}
              // The answered decision leaves, so Submit stays busy until it does.
              onPress={() =>
                presses.press(submitPress, () => answer({ key: decision.key, label: submit.label, text: submit.text, from: answeredFrom }), {
                  after: "hold",
                  onSuccess: () => {
                    setTyped("");
                    setPicked(null);
                    onAnswered();
                  },
                })
              }
            />
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * A card asking several questions (TR-207): a tab per header (answered ones ticked, the shown one
 * outlined), the answers so far, then the shown question as a single card draws it. Back and Next
 * step through; the last question's Submit sends every answer in one message, once all have one.
 * The picks are kept per decision (`./several-drafts`), so the board's pills and a reconnect keep them.
 */
function SeveralCard({ decision, theme, compact, onAnswered, showAgent = false, answeredFrom = "screen", readOnlyNote = null }: DecisionCardProps) {
  const actions = useRef<View>(null);
  const reveal = useRevealFocused(actions);
  const answer = useRpc(answerDecision);
  const [whyOpen, setWhyOpen] = useState(false);
  const presses = useActions(decisionCall(decision));
  const busy = presses.busy;
  const questions = questionsOf(decision);
  const answerable = readOnlyNote === null;
  // A card that cannot be answered keeps nothing: its picks would outlive it.
  const kept = useSeveralDrafts({ key: decision.key, status: decision.status, questions });
  const [local, setLocal] = useState(() => freshDrafts(questions.length));
  const { drafts, current } = answerable ? kept.state : local;
  const update = (change: (state: typeof local) => typeof local) => (answerable ? kept.update(change) : setLocal(change));
  const styles = useCardStyles(theme, compact, decision.blocking && answerable);
  const { colors } = theme;
  const question = questions[current] ?? questions[0];
  const optionRows = useMemo(() => decisionOptionRows(question ?? { options: [], recommended: "", reason: "" }), [question]);
  if (question === undefined) return null;
  const answered = answeredFlags(questions, drafts);
  const draft = drafts[current] ?? null;
  const picked: DecisionPick = draft === null ? null : draft.label === null ? "other" : optionRows.rows.findIndex((row) => row.label === draft.label);
  const submit = decisionSubmit(optionRows.rows, picked, draft?.typed ?? "", ANSWER_PLACEHOLDER);
  const recap = recapLine(questions, drafts, current);
  const last = current === questions.length - 1;
  const ready = allAnswered(answered);

  function setDraft(next: QuestionDraft | null): void {
    update((state) => ({ ...state, drafts: state.drafts.map((each, index) => (index === state.current ? next : each)) }));
  }
  function go(index: number): void {
    setWhyOpen(false);
    update((state) => ({ ...state, current: index }));
  }
  function pick(next: DecisionPick): void {
    const typed = draft?.typed ?? "";
    if (next === null) setDraft(null);
    else if (next === "other") setDraft({ label: null, typed });
    else setDraft({ label: optionRows.rows[next]?.label ?? null, typed });
  }

  return (
    <View style={styles.card}>
      {showAgent ? <Text style={styles.who}>{askedBy(decision)}</Text> : null}
      <View style={styles.tabs} accessibilityRole="tablist">
        {questions.map((each, index) => {
          const isCurrent = index === current;
          const isAnswered = answered[index] === true;
          return (
            <Pressable
              key={`${index}:${each.header}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: isCurrent }}
              accessibilityLabel={`${each.header}${isAnswered ? ", answered" : ""}`}
              style={[styles.tab, isAnswered ? styles.tabAnswered : null, isCurrent ? styles.tabCurrent : null]}
              onPress={() => go(index)}
            >
              <Text style={[styles.tabText, isAnswered ? styles.tabTextAnswered : null, isCurrent ? styles.tabTextCurrent : null]}>
                {isAnswered ? `✓ ${each.header}` : each.header}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {recap === null ? null : <Text style={styles.recap}>{recap}</Text>}
      <Text style={styles.question}>
        Question {current + 1} of {questions.length}: {question.question}
      </Text>
      {question.why === "" ? null : (
        <Pressable onPress={() => setWhyOpen((open) => !open)} disabled={question.why.length < WHY_FOLD_CHARACTERS}>
          <Text style={styles.why} numberOfLines={whyOpen ? undefined : 4}>
            {question.why}
          </Text>
          {question.why.length < WHY_FOLD_CHARACTERS ? null : <Text style={styles.more}>{whyOpen ? "less" : "more"}</Text>}
        </Pressable>
      )}
      <OptionRadios rows={optionRows.rows} picked={picked} onPick={pick} busy={busy} answerable={answerable} styles={styles} theme={theme} compact={compact} />
      {optionRows.looseReason === "" ? null : <Text style={styles.reason}>Why recommended: {optionRows.looseReason}</Text>}
      {decision.problems.length > 0 ? <Text style={styles.problems}>Incomplete block: {decision.problems.join("; ")}</Text> : null}
      {!answerable ? (
        <Text style={styles.defaultNote}>{readOnlyNote}</Text>
      ) : (
        <View ref={actions} collapsable={false} style={styles.answer}>
          <ReplyBox
            theme={theme}
            compact={compact}
            value={draft?.typed ?? ""}
            onChangeText={(typed) => setDraft({ label: draft === null ? null : draft.label, typed })}
            onFocus={reveal}
            placeholder={submit.placeholder}
            background={colors.surface0}
            editable={!busy}
            greyed={!submit.fieldEnabled}
            onPressGreyed={busy ? undefined : () => pick("other")}
          />
          <View style={[styles.actions, styles.actionsWrap]}>
            <IconButton icon="X" label="Dismiss" showLabel theme={theme} disabled={busy || draft === null} onPress={() => setDraft(null)} />
            {current === 0 ? null : <IconButton icon="ArrowLeft" label="Back" showLabel theme={theme} disabled={busy} onPress={() => go(current - 1)} />}
            {!last ? (
              <IconButton icon="Check" label="Next" showLabel tone="accent" theme={theme} disabled={busy || answered[current] !== true} onPress={() => go(current + 1)} />
            ) : (
              <IconButton
                icon="Check"
                label={`Submit ${questions.length} answers`}
                showLabel
                tone="accent"
                theme={theme}
                disabled={busy || !ready}
                state={presses.stateOf("submit") ?? (busy ? "busy" : undefined)}
                onPress={() =>
                  presses.press("submit", () => answer({ key: decision.key, label: null, text: "", from: answeredFrom, answers: draftAnswers(questions, drafts) }), {
                    after: "hold",
                    onSuccess: () => {
                      kept.forget();
                      onAnswered();
                    },
                  })
                }
              />
            )}
          </View>
        </View>
      )}
    </View>
  );
}

type CardStyles = ReturnType<typeof cardStyles>;

function cardStyles(colors: PluginTheme["colors"], compact: boolean, waiting: boolean) {
  return {
      card: {
        borderWidth: 1,
        borderColor: waiting ? colors.statusWarning : colors.border,
        borderRadius: 10,
        padding: compact ? SPACE.md : SPACE.lg,
        gap: SPACE.md,
        backgroundColor: colors.surface1,
      },
      who: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      more: { color: colors.accent, fontSize: FONT_SIZE.caption },
      question: { color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const, lineHeight: lineHeightFor(FONT_SIZE.body) },
      why: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      // No box or fill per option: a radio, the label, a muted description, and space between.
      options: { gap: SPACE.xxs },
      option: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: SPACE.md, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xxs, borderRadius: 6 },
      radio: { width: RADIO_SIZE, height: RADIO_SIZE, borderRadius: RADIO_SIZE / 2, borderWidth: 1.5, borderColor: colors.foregroundMuted, alignItems: "center" as const, justifyContent: "center" as const, marginTop: 1 },
      radioPicked: { borderColor: colors.accent },
      radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
      optionText: { flex: 1, minWidth: 0, gap: SPACE.xxs },
      optionHead: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 6 },
      optionLabel: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small), flexShrink: 1 },
      optionLabelPicked: { fontWeight: "600" as const },
      description: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
      badge: {
        color: colors.accent,
        fontSize: FONT_SIZE.micro,
        lineHeight: FONT_SIZE.micro + 4,
        fontWeight: "600" as const,
        borderWidth: 1,
        borderColor: withAlpha(colors.accent, 0.4),
        borderRadius: 4,
        paddingHorizontal: SPACE.xs,
        overflow: "hidden" as const,
      },
      // Under the option's words: past the radio, its gap and the row's padding.
      optionImages: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "flex-start" as const, gap: SPACE.sm, marginLeft: SPACE.xxs + RADIO_SIZE + SPACE.md, marginBottom: SPACE.sm },
      missingImage: { color: colors.statusDanger, fontSize: FONT_SIZE.caption },
      reason: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontStyle: "italic" as const },
      defaultNote: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      problems: { color: colors.statusWarning, fontSize: FONT_SIZE.caption },
      answer: { gap: SPACE.sm },
      actions: { flexDirection: "row" as const, gap: SPACE.sm, alignItems: "center" as const },
      // Dismiss, Back and Submit N answers are wider than a phone holds in one row.
      actionsWrap: { flexWrap: "wrap" as const },
      // A card asking several questions (TR-207): a tab per header, the answers so far under them.
      tabs: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.xs },
      tab: { paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xxs + 1, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
      tabCurrent: { borderColor: colors.foregroundMuted },
      tabAnswered: { borderColor: withAlpha(colors.accent, 0.4) },
      tabText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
      tabTextCurrent: { color: colors.foreground, fontWeight: "600" as const },
      tabTextAnswered: { color: colors.accent },
      recap: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
  };
}

function useCardStyles(theme: PluginTheme, compact: boolean, waiting: boolean): CardStyles {
  const { colors } = theme;
  return useMemo(() => cardStyles(colors, compact, waiting), [colors, compact, waiting]);
}

/** The options as a light radio list, Other last where the card can be answered (TR-030). */
function OptionRadios({
  rows,
  picked,
  onPick,
  busy,
  answerable,
  styles,
  theme,
  compact,
}: {
  rows: DecisionOptionRow[];
  picked: DecisionPick;
  onPick: (pick: DecisionPick) => void;
  busy: boolean;
  answerable: boolean;
  styles: CardStyles;
  theme: PluginTheme;
  compact: boolean;
}) {
  return (
    <View style={styles.options} accessibilityRole="radiogroup">
      {rows.map((row, index) => {
        const isPicked = picked === index;
        // The option's images that can be shown, the set its viewer moves through.
        const gallery = row.images.flatMap((image) => (image.path === null ? [] : [{ source: image.path, alt: image.caption === "" ? image.file : image.caption, title: row.label }]));
        return (
          <View key={`${index}:${row.label}`}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: isPicked, disabled: busy || !answerable }}
              accessibilityLabel={row.recommended ? `${row.label}, recommended` : row.label}
              disabled={busy || !answerable}
              style={styles.option}
              // Pressing the picked option again unpicks it; what was typed stays, greyed.
              onPress={() => onPick(isPicked ? null : index)}
            >
              <View style={[styles.radio, isPicked ? styles.radioPicked : null]}>{isPicked ? <View style={styles.radioDot} /> : null}</View>
              <View style={styles.optionText}>
                <View style={styles.optionHead}>
                  <Text style={[styles.optionLabel, isPicked ? styles.optionLabelPicked : null]}>{row.label}</Text>
                  {row.recommended ? <Text style={styles.badge}>Recommended</Text> : null}
                </View>
                {row.consequence === "" ? null : <Text style={styles.description}>{row.consequence}</Text>}
                {row.reason === "" ? null : <Text style={styles.description}>Why: {row.reason}</Text>}
              </View>
            </Pressable>
            {row.images.length === 0 ? null : (
              <View style={styles.optionImages}>
                {row.images.map((image, imageIndex) =>
                  image.path === null ? (
                    <Text key={`${imageIndex}:${image.file}`} style={styles.missingImage}>
                      {image.file} (not in the ticket's evidence folder)
                    </Text>
                  ) : (
                    <ImageThumbnail
                      key={`${imageIndex}:${image.file}`}
                      source={image.path}
                      alt={image.caption === "" ? image.file : image.caption}
                      theme={theme}
                      height={compact ? OPTION_IMAGE_HEIGHT - 12 : OPTION_IMAGE_HEIGHT}
                      set={gallery}
                      index={gallery.findIndex((each) => each.source === image.path)}
                      captioned
                    />
                  ),
                )}
              </View>
            )}
          </View>
        );
      })}
      {/* Always last where the card can be answered: the agent's own "Other" and "Change…" options are hidden (TR-061); this one opens the box. */}
      {!answerable ? null : (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: picked === "other", disabled: busy }}
          disabled={busy}
          style={styles.option}
          onPress={() => onPick(picked === "other" ? null : "other")}
        >
          <View style={[styles.radio, picked === "other" ? styles.radioPicked : null]}>{picked === "other" ? <View style={styles.radioDot} /> : null}</View>
          <View style={styles.optionText}>
            <Text style={[styles.optionLabel, picked === "other" ? styles.optionLabelPicked : null]}>Other</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
