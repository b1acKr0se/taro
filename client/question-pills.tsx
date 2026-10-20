/**
 * A card asking several questions (TR-207) on a board or Inbox card: a pill per header (answered
 * ones `✓ <header>: <answer>`, the shown one outlined), then the shown question and its option
 * chips. A chip answers its question and moves to the next one still open; once all are answered
 * the chips give way to Send. A chip that asks for words, or Answer, opens the full card at that
 * question. The picks are the chat card's own (`./several-drafts`).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { answerDecision } from "../shared/contracts";
import { optionChips, type OptionChip } from "../shared/decision-view";
import { questionsOf } from "../shared/reports";
import { allAnswered, answeredFlags, draftAnswers, draftText, nextUnanswered, pillText } from "../shared/several-questions";
import type { StoredDecision } from "../shared/state";
import { CentredLabel } from "./centred-label";
import { controlColors } from "./control-colors";
import { Pressable } from "./focus";
import { useSeveralDrafts } from "./several-drafts";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";
import { Spinner } from "./ui";
import { decisionCall } from "./shared-presses";
import { useActions } from "./use-actions";

export function QuestionPills({
  decision,
  theme,
  onOpen,
  onAnswered,
}: {
  decision: StoredDecision;
  theme: PluginTheme;
  /** Opens the full card, at the question the pills show. */
  onOpen: () => void;
  onAnswered: () => void;
}) {
  const answer = useRpc(answerDecision);
  // One guard with the chat card and the Ticket tab (TR-191): the decision takes one answer.
  const presses = useActions(decisionCall(decision));
  const questions = questionsOf(decision);
  const kept = useSeveralDrafts({ key: decision.key, status: decision.status, questions });
  const { drafts, current } = kept.state;
  // A pill tapped once all are answered: its chips come back, its answer kept until another is picked.
  const [changing, setChanging] = useState(false);
  const question = questions[current] ?? questions[0];
  const chips = useMemo(() => (question === undefined ? [] : optionChips(question)), [question]);
  const { colors } = theme;
  const control = useMemo(() => controlColors(colors), [colors]);
  const styles = useMemo(
    () => ({
      block: { gap: SPACE.sm },
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.xs },
      pill: { maxWidth: "100%" as const, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xxs + 1, borderRadius: 6, borderWidth: 1, borderColor: control.border },
      pillCurrent: { borderColor: colors.foreground },
      pillAnswered: { borderColor: control.accentBorder },
      pillText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption) },
      pillTextCurrent: { color: colors.foreground, fontWeight: "600" as const },
      pillTextAnswered: { color: colors.accent },
      line: { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      note: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) },
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.xs,
        maxWidth: "100%" as const,
        paddingHorizontal: SPACE.sm,
        paddingVertical: SPACE.xxs + 1,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: control.border,
        backgroundColor: control.fill,
      },
      recommended: { borderColor: control.accentBorder, backgroundColor: withAlpha(colors.accent, 0.1) },
      // The answer already picked, when its question is shown again to change it.
      picked: { borderColor: colors.accent },
      chipIcon: { flexShrink: 0 },
      chipLabel: { flexShrink: 1, color: colors.foreground, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption) },
      action: {
        flexDirection: "row" as const,
        alignSelf: "flex-start" as const,
        alignItems: "center" as const,
        gap: SPACE.xs,
        paddingHorizontal: SPACE.sm,
        paddingVertical: SPACE.xxs,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: control.accentBorder,
        backgroundColor: withAlpha(colors.accent, 0.1),
      },
      actionText: { color: colors.accent, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), fontWeight: "600" as const },
    }),
    [colors, control],
  );
  if (question === undefined) return null;
  const answered = answeredFlags(questions, drafts);
  const ready = allAnswered(answered) && !changing;
  const sending = presses.stateOf("submit") === "busy";

  function show(index: number): void {
    kept.update((state) => ({ ...state, current: index }));
  }

  function press(chip: OptionChip): void {
    const typed = drafts[current]?.typed ?? "";
    if (chip.asksForWords) {
      // Picked here, its words typed in the full card at this question.
      kept.update((state) => ({ ...state, drafts: state.drafts.map((each, index) => (index === current ? { label: chip.label, typed } : each)) }));
      onOpen();
      return;
    }
    kept.update((state) => {
      const next = state.drafts.map((each, index) => (index === state.current ? { label: chip.label, typed } : each));
      return { drafts: next, current: nextUnanswered(answeredFlags(questions, next), state.current) ?? state.current };
    });
    setChanging(false);
  }

  function send(): void {
    presses.press("submit", () => answer({ key: decision.key, label: null, text: "", from: "screen", answers: draftAnswers(questions, drafts) }), {
      after: "hold",
      onSuccess: () => {
        kept.forget();
        onAnswered();
      },
    });
  }

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        {questions.map((each, index) => {
          const isCurrent = index === current && !ready;
          const draft = drafts[index] ?? null;
          const isAnswered = answered[index] === true && draft !== null;
          return (
            <Pressable
              key={`${index}:${each.header}`}
              accessibilityRole="button"
              accessibilityLabel={`${each.header}${isAnswered ? `, answered ${draftText(draft)}` : ""}`}
              accessibilityState={{ selected: isCurrent, disabled: presses.busy }}
              disabled={presses.busy}
              style={[styles.pill, isAnswered ? styles.pillAnswered : null, isCurrent ? styles.pillCurrent : null]}
              // Once all are in, a pill brings its question's chips back to change its answer.
              onPress={() => {
                setChanging(allAnswered(answered));
                show(index);
              }}
            >
              <CentredLabel style={[styles.pillText, isAnswered ? styles.pillTextAnswered : null, isCurrent ? styles.pillTextCurrent : null]} numberOfLines={1}>
                {pillText(each.header, isAnswered ? draftText(draft) : null)}
              </CentredLabel>
            </Pressable>
          );
        })}
      </View>
      {ready ? (
        <Text style={styles.note}>All answered · tap a question to change it</Text>
      ) : (
        <>
          <Text style={styles.line} numberOfLines={3}>
            {current + 1} of {questions.length} · {question.question}
          </Text>
          <View style={styles.row}>
            {chips.map((chip, index) => {
              const picked = drafts[current]?.label === chip.label;
              return (
                <Pressable
                  key={`${index}:${chip.label}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${chip.asksForWords ? "Open to answer" : "Pick"}: ${chip.label}${chip.recommended ? " (recommended)" : ""}`}
                  accessibilityState={{ selected: picked, disabled: presses.busy }}
                  disabled={presses.busy}
                  style={[styles.chip, chip.recommended ? styles.recommended : null, picked ? styles.picked : null, presses.busy ? { opacity: 0.5 } : null]}
                  onPress={() => press(chip)}
                >
                  {/* Kept whole beside a long label, which shrinks instead. */}
                  {chip.recommended ? (
                    <View style={styles.chipIcon}>
                      <Icon name="Star" size={11} color={colors.accent} />
                    </View>
                  ) : null}
                  <CentredLabel style={styles.chipLabel} numberOfLines={1}>
                    {chip.label}
                  </CentredLabel>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ready ? `Send ${questions.length} answers` : `Answer: ${question.question}`}
        accessibilityState={{ busy: sending, disabled: presses.busy }}
        disabled={ready && presses.busy}
        style={styles.action}
        onPress={ready ? send : onOpen}
      >
        <CentredLabel style={styles.actionText}>{ready ? `Send ${questions.length} answers` : "Answer"}</CentredLabel>
        {sending ? <Spinner size={12} color={colors.accent} /> : <Icon name="ArrowRight" size={12} color={colors.accent} />}
      </Pressable>
    </View>
  );
}

