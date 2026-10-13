/**
 * One decision an agent asked (decision 28): the question, why it matters,
 * the options as buttons with the recommended one marked, the default for a
 * non-blocking decision, and a box for answering in your own words.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { answerDecision } from "../shared/contracts";
import type { StoredDecision } from "../shared/state";
import { errorText } from "./format";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton } from "./ui";

/** "SC-003 · Add validation" — the agent's title already starts with its ticket when it has one. */
export function askedBy(decision: StoredDecision): string {
  const title = decision.agentTitle ?? decision.agentRole;
  if (decision.ticket === null || title.startsWith(decision.ticket)) return `${decision.project} · ${title}`;
  return `${decision.project} · ${decision.ticket} · ${title}`;
}

/** A "why" longer than this folds to four lines behind "more". */
const WHY_FOLD_CHARACTERS = 220;

export function DecisionCard({
  decision,
  theme,
  compact,
  onAnswered,
  showAgent = false,
  answeredFrom = "screen",
  readOnlyNote = null,
}: {
  decision: StoredDecision;
  theme: PluginTheme;
  compact: boolean;
  onAnswered: () => void;
  /** Names who asked (in the Inbox and Walk me through). */
  showAgent?: boolean;
  /** Where the card is, for the ANSWER record. */
  answeredFrom?: "screen" | "tab";
  /** Set when the card cannot be answered: the buttons are inert and this replaces the answer box. */
  readOnlyNote?: string | null;
}) {
  const toast = useToast();
  const answer = useRpc(answerDecision);
  const [typed, setTyped] = useState("");
  const [whyOpen, setWhyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { colors } = theme;
  // A card that cannot be answered does not ask for the user.
  const waiting = decision.blocking && readOnlyNote === null;
  const styles = useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: waiting ? colors.statusWarning : colors.border,
        borderRadius: 10,
        padding: compact ? 10 : 12,
        gap: 8,
        backgroundColor: colors.surface1,
      },
      who: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      blocking: { color: colors.statusWarning, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.5 },
      more: { color: colors.accent, fontSize: FONT_SIZE.caption },
      question: { color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const, lineHeight: lineHeightFor(FONT_SIZE.body) },
      why: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      options: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      option: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, maxWidth: "100%" as const, flexShrink: 1 },
      recommended: { borderColor: colors.accent, backgroundColor: colors.surface2 },
      optionLabel: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "600" as const },
      consequence: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      badge: { color: colors.accent, fontSize: FONT_SIZE.micro, fontWeight: "600" as const },
      reason: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontStyle: "italic" as const },
      defaultNote: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      problems: { color: colors.statusWarning, fontSize: FONT_SIZE.caption },
      row: { flexDirection: "row" as const, gap: 6, alignItems: "flex-end" as const },
      input: {
        flex: 1,
        color: colors.foreground,
        fontSize: FONT_SIZE.small,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        minHeight: 34,
        backgroundColor: colors.surface0,
      },
    }),
    [colors, compact, waiting],
  );

  async function send(label: string | null, text: string): Promise<void> {
    setBusy(true);
    try {
      await answer({ key: decision.key, label, text, from: answeredFrom });
      setTyped("");
      onAnswered();
    } catch (caught) {
      toast.error(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  function press(label: string, prompt: string): void {
    // An option ending with "…" asks for the user's own words; once typed, they go with the option.
    if (typed.trim() === "" && (prompt.trim().endsWith("\u2026") || label.trim().endsWith("\u2026"))) {
      setTyped(prompt.replace(/\u2026\s*$/, "").trim() + " ");
      return;
    }
    void send(label, typed);
  }

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
      <View style={styles.options}>
        {decision.options.map((option) => {
          const isRecommended = option.label === decision.recommended;
          return (
            <Pressable
              key={option.label}
              accessibilityRole="button"
              disabled={busy || readOnlyNote !== null}
              style={[styles.option, isRecommended ? styles.recommended : null]}
              onPress={() => press(option.label, option.prompt)}
            >
              {isRecommended ? <Text style={styles.badge}>RECOMMENDED</Text> : null}
              <Text style={styles.optionLabel}>{option.label}</Text>
              {option.consequence === "" ? null : <Text style={styles.consequence}>{option.consequence}</Text>}
            </Pressable>
          );
        })}
      </View>
      {decision.reason === "" ? null : <Text style={styles.reason}>Why recommended: {decision.reason}</Text>}
      {!decision.blocking && readOnlyNote === null && decision.default !== "" ? <Text style={styles.defaultNote}>Going with “{decision.default}” unless you say otherwise.</Text> : null}
      {decision.problems.length > 0 ? <Text style={styles.problems}>Incomplete block: {decision.problems.join("; ")}</Text> : null}
      {readOnlyNote !== null ? (
        <Text style={styles.defaultNote}>{readOnlyNote}</Text>
      ) : (
        <View style={styles.row}>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Answer in your own words…"
            placeholderTextColor={colors.foregroundMuted}
            multiline
            style={styles.input}
          />
          <IconButton icon="Send" label="Send answer" theme={theme} disabled={busy || typed.trim() === ""} onPress={() => void send(null, typed)} />
        </View>
      )}
    </View>
  );
}
