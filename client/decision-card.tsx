/**
 * One decision an agent asked (decision 28): the question, why it matters,
 * the options as a light radio list (label, then a muted description; the
 * recommended one tagged with its reason), the default for a non-blocking
 * decision, a box for your own words, and Submit / Dismiss. TR-030: the
 * side-by-side option boxes broke on long text and phones; the list follows
 * Claude Code's question prompt, and Submit sends the picked option with any
 * typed words (TR-028). TR-055: an option's images sit under it, captioned, and open in a
 * viewer of that option's images alone, its label in the bar. TR-061: options that only stand for
 * typing ("Change…", "Other") are hidden, the field says it takes a change on an approval, and a scope
 * approval with a template plan is the compact plan card (`./plan-card`).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { answerDecision } from "../shared/contracts";
import { answerPlaceholder, askedBy, decisionOptionRows, decisionSubmit } from "../shared/decision-view";
import type { StoredDecision } from "../shared/state";
import { useRevealFocused } from "./keyboard";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { ImageThumbnail } from "./image-view";
import { PlanDecision } from "./plan-card";
import { IconButton } from "./ui";
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
  // Submit is revealed with the field, so it stays above the keyboard while the reader types.
  const actions = useRef<View>(null);
  const reveal = useRevealFocused(actions);
  const answer = useRpc(answerDecision);
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const presses = useActions();
  const busy = presses.busy;
  const { colors } = theme;
  const optionRows = useMemo(() => decisionOptionRows(decision), [decision]);
  const submit = decisionSubmit(optionRows.rows, picked, typed, answerPlaceholder(decision));
  const answerable = readOnlyNote === null;
  // A card that cannot be answered does not ask for the user.
  const waiting = decision.blocking && answerable;
  const styles = useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: waiting ? colors.statusWarning : colors.border,
        borderRadius: 10,
        padding: compact ? SPACE.md : SPACE.lg,
        gap: SPACE.md,
        backgroundColor: colors.surface1,
      },
      who: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      blocking: { color: colors.statusWarning, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.5 },
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
      input: {
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
      actions: { flexDirection: "row" as const, gap: SPACE.sm, alignItems: "center" as const },
    }),
    [colors, compact, waiting],
  );

  return (
    <View style={styles.card}>
      {showAgent ? <Text style={styles.who}>{askedBy(decision)}</Text> : null}
      {waiting ? <Text style={styles.blocking}>WAITING FOR YOU</Text> : null}
      <Text style={styles.question}>{decision.question}</Text>
      {decision.why === "" ? null : (
        <Pressable onPress={() => setWhyOpen((open) => !open)} disabled={decision.why.length < WHY_FOLD_CHARACTERS}>
          <Text style={styles.why} numberOfLines={whyOpen ? undefined : 4}>
            {decision.why}
          </Text>
          {decision.why.length < WHY_FOLD_CHARACTERS ? null : <Text style={styles.more}>{whyOpen ? "less" : "more"}</Text>}
        </Pressable>
      )}
      <View style={styles.options} accessibilityRole="radiogroup">
        {optionRows.rows.map((row, index) => {
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
                // Pressing the picked option again unpicks it, leaving only the typed words.
                onPress={() => setPicked(isPicked ? null : index)}
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
      </View>
      {optionRows.looseReason === "" ? null : <Text style={styles.reason}>Why recommended: {optionRows.looseReason}</Text>}
      {!decision.blocking && answerable && decision.default !== "" ? <Text style={styles.defaultNote}>Going with “{decision.default}” unless you say otherwise.</Text> : null}
      {decision.problems.length > 0 ? <Text style={styles.problems}>Incomplete block: {decision.problems.join("; ")}</Text> : null}
      {!answerable ? (
        <Text style={styles.defaultNote}>{readOnlyNote}</Text>
      ) : (
        <>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            onFocus={reveal}
            placeholder={submit.placeholder}
            placeholderTextColor={colors.foregroundMuted}
            multiline
            style={styles.input}
          />
          <View ref={actions} collapsable={false} style={styles.actions}>
            <IconButton
              icon="Check"
              label="Submit"
              showLabel
              tone="accent"
              theme={theme}
              disabled={busy || !submit.enabled}
              state={presses.stateOf("submit")}
              // The answered decision leaves, so Submit stays busy until it does.
              onPress={() =>
                presses.press("submit", () => answer({ key: decision.key, label: submit.label, text: submit.text, from: answeredFrom }), {
                  after: "hold",
                  onSuccess: () => {
                    setTyped("");
                    setPicked(null);
                    onAnswered();
                  },
                })
              }
            />
            {picked === null && typed === "" ? null : (
              <IconButton icon="X" label="Dismiss" showLabel theme={theme} disabled={busy} onPress={() => { setPicked(null); setTyped(""); }} />
            )}
          </View>
        </>
      )}
    </View>
  );
}
