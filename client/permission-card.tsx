/**
 * What an agent is waiting on — the Manager, an owner or a subagent — answered
 * in its chat. The heading names the agent as the user
 * knows it (`permission-heading.ts`).
 *
 * An agent that asks the user something — Claude's AskUserQuestion — or
 * wants a permission is stopped on a pending permission request, and until
 * this existed the panel said only that it was waiting, so the user had to
 * open the agent to see what for. A question is drawn as a form, the way the
 * agent's own tab draws it (`questions.ts` holds the rules, ported from
 * Paseo); anything else — a tool to run, a plan to approve — as a card with
 * the request's own buttons, or Allow and Deny when it names none.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

import { Pressable } from "./focus";
import { useRevealFocused } from "./keyboard";
import { Markdown } from "./markdown";
import { permissionHeading, type Asker } from "./permission-heading";
import { ReplyBox } from "./reply-box";
import {
  allAnswered,
  buildAnswers,
  dismissLabel,
  dismissSubmitsEmpty,
  hasOtherRow,
  isAnswered,
  parseQuestions,
  pickOption,
  pickOther,
  showsTextInput,
  typingEnabled,
  type OtherPicks,
  type OtherTexts,
  type Question,
  type Selections,
} from "./questions";
import { IconButton, MONOSPACE, type Tone } from "./ui";
import { useActions } from "./use-actions";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";

type AgentHandle = ReturnType<ReturnType<typeof usePaseo>["agents"]["ref"]>;
export type PermissionRequest = NonNullable<AgentHandle["pendingPermissions"]>[number];
export type PermissionResponse = Parameters<AgentHandle["respondToPermission"]>[0]["response"];

/**
 * An agent's pending requests, and how to answer one as the agent's own tab
 * would. Answered ones are hidden at once rather than when the next timeline
 * read confirms it, so a card cannot be answered twice; on a failure the card
 * comes back, and its button reports the reason.
 */
export function usePendingRequests(
  agentId: string,
  requests: readonly PermissionRequest[] | undefined,
  /** Called as an answer goes out — the transcript follows its end again. */
  onAnswering: () => void,
) {
  const paseo = usePaseo();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const pending = (requests ?? []).filter((request) => !answered.has(request.id));

  function respond(requestId: string, response: PermissionResponse): Promise<void> {
    onAnswering();
    return paseo.agents
      .ref(agentId)
      .respondToPermission({ requestId, response })
      .then(() => setAnswered((current) => new Set([...current, requestId])));
  }

  return { pending, respond };
}

interface CardProps {
  request: PermissionRequest;
  /** Who asks, named in the heading. */
  asker: Asker;
  theme: PluginTheme;
  compact: boolean;
  /** Resolves when the daemon has the answer; the card stays busy until then. */
  onRespond: (response: PermissionResponse) => Promise<void>;
  onOpenLink: (url: string) => void;
}

function useCardStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(() => {
    const { colors } = theme;
    return {
      card: {
        borderWidth: 1,
        borderColor: colors.accent,
        borderRadius: 10,
        backgroundColor: colors.surface1,
        padding: compact ? 10 : 12,
        gap: 10,
      },
      heading: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      headingText: { color: colors.accent, fontSize: FONT_SIZE.small, fontWeight: "600" as const },
      tabs: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      tab: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
      },
      tabActive: { borderColor: colors.foreground, backgroundColor: colors.surface2 },
      tabText: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: labelLineHeightFor(FONT_SIZE.small) },
      tabTextActive: { color: colors.foreground },
      question: { color: colors.foreground, fontSize: FONT_SIZE.content, fontWeight: "600" as const, lineHeight: lineHeightFor(FONT_SIZE.content) },
      option: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 10, paddingVertical: 6 },
      mark: { color: colors.foregroundMuted, fontSize: FONT_SIZE.subtitle, lineHeight: lineHeightFor(FONT_SIZE.body), width: 18 },
      markSelected: { color: colors.accent },
      optionText: { flex: 1, gap: 2 },
      optionLabel: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
      optionDescription: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      body: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
      code: {
        color: colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: FONT_SIZE.code,
        backgroundColor: colors.surface0,
        borderRadius: 6,
        padding: 8,
      },
    };
  }, [theme, compact]);
}

export function PermissionCard(props: CardProps) {
  const questions = useMemo(
    () => (props.request.kind === "question" ? parseQuestions(props.request.input) : null),
    [props.request],
  );
  return questions === null ? <RequestCard {...props} /> : <QuestionCard {...props} questions={questions} />;
}

function QuestionCard({ request, asker, theme, compact, onRespond, questions }: CardProps & { questions: Question[] }) {
  const styles = useCardStyles(theme, compact);
  const reveal = useRevealFocused();
  const [selections, setSelections] = useState<Selections>({});
  const [otherTexts, setOtherTexts] = useState<OtherTexts>({});
  const [otherPicks, setOtherPicks] = useState<OtherPicks>({});
  const [active, setActive] = useState(0);
  const presses = useActions();
  const busy = presses.busy;

  const index = Math.min(active, questions.length - 1);
  const question = questions[index];
  const last = index === questions.length - 1;
  const ready = allAnswered(questions, selections, otherTexts, otherPicks);

  function respond(key: string, response: PermissionResponse): void {
    // Stays busy on success: the request leaves the list once the daemon has
    // the answer, and this card goes with it.
    presses.press(key, () => onRespond(response), { after: "hold" });
  }

  function submit(): void {
    if (!ready) return;
    respond("submit", { behavior: "allow", updatedInput: { ...request.input, answers: buildAnswers(questions, selections, otherTexts, otherPicks) } });
  }

  function dismiss(): void {
    if (dismissSubmitsEmpty(questions)) {
      respond("dismiss", { behavior: "allow", updatedInput: { ...request.input, answers: buildAnswers(questions, selections, otherTexts, otherPicks) } });
      return;
    }
    respond("dismiss", { behavior: "deny", message: "Dismissed by user" });
  }

  // A pick never clears what was typed: the words stay, greyed, until Other is picked again (TR-083).
  function choose(questionIndex: number, option: number, multiSelect: boolean): void {
    const next = pickOption(selections[questionIndex], otherPicks[questionIndex] === true, option, multiSelect);
    setSelections({ ...selections, [questionIndex]: next.selection });
    setOtherPicks({ ...otherPicks, [questionIndex]: next.otherPicked });
    // A single choice moves on to the next question, as the agent's tab does.
    if (!multiSelect && next.selection.size > 0 && !last) setActive(questionIndex + 1);
  }

  function chooseOther(questionIndex: number, multiSelect: boolean): void {
    const next = pickOther(selections[questionIndex], otherPicks[questionIndex] === true, multiSelect);
    setSelections({ ...selections, [questionIndex]: next.selection });
    setOtherPicks({ ...otherPicks, [questionIndex]: next.otherPicked });
  }

  function type(questionIndex: number, text: string): void {
    setOtherTexts({ ...otherTexts, [questionIndex]: text });
  }

  if (question === undefined) return null;
  const selected = selections[index] ?? new Set<number>();
  const answeredHere = isAnswered(question, index, selections, otherTexts, otherPicks);
  const otherOn = otherPicks[index] === true;

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Icon name="MessageSquare" size={13} color={theme.colors.accent} />
        <Text style={styles.headingText}>{permissionHeading(asker, "question")}</Text>
      </View>

      {questions.length > 1 ? (
        <View style={styles.tabs}>
          {questions.map((entry, entryIndex) => {
            const current = entryIndex === index;
            const done = isAnswered(entry, entryIndex, selections, otherTexts, otherPicks);
            return (
              <Pressable
                key={`${entry.header}-${entryIndex}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: current }}
                style={[styles.tab, current ? styles.tabActive : null]}
                onPress={() => setActive(entryIndex)}
              >
                {done ? <Icon name="Check" size={11} color={theme.colors.statusSuccess} /> : null}
                <Text style={[styles.tabText, current ? styles.tabTextActive : null]}>{entry.header}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.question}>{question.question}</Text>

      {question.options.length === 0 ? null : (
        <View accessibilityRole={question.multiSelect ? undefined : "radiogroup"}>
          {question.options.map((option, optionIndex) => (
            <OptionRow
              key={`${option.label}-${optionIndex}`}
              styles={styles}
              multiSelect={question.multiSelect}
              on={selected.has(optionIndex)}
              busy={busy}
              label={option.label}
              description={option.description}
              onPress={() => choose(index, optionIndex, question.multiSelect)}
            />
          ))}
          {hasOtherRow(question) ? (
            <OptionRow styles={styles} multiSelect={question.multiSelect} on={otherOn} busy={busy} label="Other" description={undefined} onPress={() => chooseOther(index, question.multiSelect)} />
          ) : null}
        </View>
      )}

      {showsTextInput(question) ? (
        // Submit or Next answers the whole form; the box is greyed until Other is picked.
        <ReplyBox
          key={`other-${index}`}
          theme={theme}
          compact={compact}
          value={otherTexts[index] ?? ""}
          onChangeText={(text) => type(index, text)}
          onFocus={reveal}
          placeholder={question.placeholder ?? "Your answer…"}
          accessibilityLabel={question.question}
          editable={!busy}
          greyed={!typingEnabled(question, index, otherPicks)}
          onPressGreyed={busy ? undefined : () => chooseOther(index, question.multiSelect)}
          background={theme.colors.surface0}
        />
      ) : null}

      <View style={styles.actions}>
        <IconButton icon="X" label={dismissLabel(questions)} showLabel theme={theme} disabled={busy} state={presses.stateOf("dismiss")} onPress={dismiss} />
        {last ? (
          <IconButton
            icon="Check"
            label="Submit"
            showLabel
            tone="accent"
            theme={theme}
            disabled={busy || !ready}
            state={presses.stateOf("submit")}
            onPress={submit}
          />
        ) : (
          <IconButton
            icon="Check"
            label="Next"
            showLabel
            tone="accent"
            theme={theme}
            disabled={busy || !answeredHere}
            onPress={() => setActive(index + 1)}
          />
        )}
      </View>
    </View>
  );
}

/** One option of a question: a radio, or a checkbox in a multi-select, then its label and description. */
function OptionRow({
  styles,
  multiSelect,
  on,
  busy,
  label,
  description,
  onPress,
}: {
  styles: ReturnType<typeof useCardStyles>;
  multiSelect: boolean;
  on: boolean;
  busy: boolean;
  label: string;
  description: string | undefined;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole={multiSelect ? "checkbox" : "radio"} accessibilityState={{ checked: on, disabled: busy }} disabled={busy} style={styles.option} onPress={onPress}>
      <Text style={[styles.mark, on ? styles.markSelected : null]}>{multiSelect ? (on ? "☑" : "☐") : on ? "◉" : "○"}</Text>
      <View style={styles.optionText}>
        <Text style={styles.optionLabel}>{label}</Text>
        {description === undefined ? null : <Text style={styles.optionDescription}>{description}</Text>}
      </View>
    </Pressable>
  );
}

/** A few lines saying what a non-question request wants to do. */
function requestSummary(request: PermissionRequest): { markdown: string | null; code: string | null } {
  const input = (request.input ?? {}) as Record<string, unknown>;
  if (request.kind === "plan" && typeof input.plan === "string") return { markdown: input.plan, code: null };
  const detail = request.detail;
  if (detail?.type === "shell") return { markdown: null, code: `$ ${detail.command}` };
  if (detail?.type === "edit" || detail?.type === "write" || detail?.type === "read") {
    return { markdown: null, code: detail.filePath };
  }
  const text = JSON.stringify(request.input ?? {}, null, 2);
  return { markdown: null, code: text === "{}" ? null : text.length > 600 ? `${text.slice(0, 600)}…` : text };
}

function actionTone(variant: string | undefined, behavior: "allow" | "deny"): Tone {
  if (variant === "danger") return "danger";
  if (variant === "primary" || (variant === undefined && behavior === "allow")) return "accent";
  return "default";
}

function RequestCard({ request, asker, theme, compact, onRespond, onOpenLink }: CardProps) {
  const styles = useCardStyles(theme, compact);
  const presses = useActions();
  const summary = useMemo(() => requestSummary(request), [request]);

  const actions =
    request.actions !== undefined && request.actions.length > 0
      ? request.actions.map((action) => ({
          key: action.id,
          label: action.label,
          tone: actionTone(action.variant, action.behavior),
          response: { behavior: action.behavior, selectedActionId: action.id } as PermissionResponse,
        }))
      : [
          { key: "allow", label: "Allow", tone: "accent" as Tone, response: { behavior: "allow" } as PermissionResponse },
          {
            key: "deny",
            label: "Deny",
            tone: "danger" as Tone,
            response: { behavior: "deny", message: "Denied by the user from the Taro panel." } as PermissionResponse,
          },
        ];

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Icon name="AlertTriangle" size={13} color={theme.colors.accent} />
        <Text style={styles.headingText}>
          {permissionHeading(asker, request.kind === "plan" ? "plan" : "permission")}
        </Text>
      </View>
      <Text style={styles.question}>{request.title ?? request.name}</Text>
      {request.description === undefined ? null : <Text style={styles.body}>{request.description}</Text>}
      {summary.markdown === null ? null : (
        <Markdown source={summary.markdown} theme={theme} onOpenLink={onOpenLink} />
      )}
      {summary.code === null ? null : (
        <Text selectable style={styles.code} numberOfLines={12}>
          {summary.code}
        </Text>
      )}
      <View style={styles.actions}>
        {actions.map((action) => (
          <IconButton
            key={action.key}
            icon={action.response.behavior === "allow" ? "Check" : "X"}
            label={action.label}
            showLabel
            tone={action.tone}
            theme={theme}
            disabled={presses.busy}
            state={presses.stateOf(action.key)}
            // Stays busy on success: the answered request leaves the list.
            onPress={() => presses.press(action.key, () => onRespond(action.response), { after: "hold" })}
          />
        ))}
      </View>
    </View>
  );
}
