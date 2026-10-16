/**
 * A delivered ticket's acceptance, drawn inline under the message where its owner presented it
 * (TR-026), like a question: the delivery summary, the evidence, then Accept and Request changes… at
 * its foot. Nothing is pinned and nothing is clipped. While the evidence is incomplete Accept is
 * withheld (the server refuses it too) and the card names what is missing.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import { acceptTicket, loadTicket, requestChanges, type Card } from "../shared/contracts";
import { evidenceSummary } from "../shared/evidence";
import { finalSummaryBody } from "../shared/execution";
import { pullRequestMark } from "../shared/pull-request-state";
import { acceptanceReady } from "./card-calls";
import { notMergedText } from "./card-now";
import { ChangeBox } from "./change-box";
import { EvidenceBlock } from "./evidence-view";
import { Pressable } from "./focus";
import { errorText, pullRequestLabel, pullRequestNumberLabel } from "./format";
import { pullRequestColor } from "./github-colors";
import { useRevealFocused } from "./keyboard";
import { Markdown } from "./markdown";
import { SPACE } from "./spacing";
import { rowButtonStyle } from "./control-colors";
import { FONT_SIZE, labelLineHeightFor, lineHeightFor } from "./type-scale";
import { AcceptancePair, Spinner } from "./ui";
import { useActions } from "./use-actions";
import { polled } from "./polling";

export function AcceptanceCard({
  card,
  project,
  theme,
  compact,
  onChanged,
  onChangesSent,
}: {
  card: Card;
  project: string;
  theme: PluginTheme;
  compact: boolean;
  onChanged: () => void;
  /** The changes went to the owner: the delivery is over (TR-131), so the card and its Accept row leave the chat at once. */
  onChangesSent?: () => void;
}) {
  const toast = useToast();
  // The buttons are revealed with the box, so they stay above the keyboard while the reader types.
  const foot = useRef<View>(null);
  const reveal = useRevealFocused(foot);
  const load = useRpc(loadTicket);
  const accept = useRpc(acceptTicket);
  const changes = useRpc(requestChanges);
  // The same query as the Ticket tab and the evidence, so they share one fetch.
  const detail = useQuery({ queryKey: ["taro", "ticket", project, card.id], queryFn: () => load({ project, ticket: card.id }), ...polled(6_000) });
  const [writing, setWriting] = useState(false);
  const [typed, setTyped] = useState("");
  const actions = useActions();
  const busy = actions.busy;
  const { colors } = theme;
  const summary = detail.data?.finalSummary === null || detail.data?.finalSummary === undefined ? null : finalSummaryBody(detail.data.finalSummary);
  const evidence = detail.data?.evidence ?? null;
  const ready = acceptanceReady(card);
  const pullRequestLook = pullRequestMark(card.pullRequestState, card.pullRequestMerged);
  const openLink = (url: string) => void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  const styles = useMemo(
    () => ({
      card: { borderWidth: 1, borderColor: ready ? colors.accent : colors.statusWarning, borderRadius: 10, padding: compact ? 10 : 12, gap: SPACE.sm + 2, backgroundColor: colors.surface1 },
      head: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: SPACE.sm },
      state: { color: ready ? colors.accent : colors.statusWarning, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.5 },
      muted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      section: { color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.5 },
      rule: { height: 1, backgroundColor: colors.border },
      foot: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: SPACE.sm },
      writing: { gap: SPACE.sm },
    }),
    [colors, compact, ready],
  );

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Icon name={ready ? "PackageCheck" : "PackageX"} size={14} color={ready ? colors.accent : colors.statusWarning} />
        <Text style={styles.state}>{ready ? `${card.id} IS READY TO ACCEPT` : `${card.id} IS NOT READY TO ACCEPT`}</Text>
        {card.pullRequest === null ? null : (
          // The board's PR mark (TR-119, TR-127, TR-152): its icon and colour say the PR's state on GitHub, and plain "PR #42" without the repository.
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${pullRequestLabel(card.pullRequest)}${pullRequestLook.spoken}`}
            onPress={() => openLink(card.pullRequest ?? "")}
            style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}
          >
            <Icon name={pullRequestLook.icon} size={12} color={pullRequestColor(pullRequestLook.tone, colors)} />
            <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }}>{pullRequestNumberLabel(card.pullRequest)}</Text>
          </Pressable>
        )}
      </View>
      {card.notMerged === null ? null : (
        // Accepted once and not merged (TR-109): why, before the delivery, as it is what to fix before accepting again.
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm }}>
          <Icon name="GitMerge" size={14} color={colors.statusWarning} />
          <Text style={[styles.muted, { flex: 1, color: colors.foreground }]}>{notMergedText(card.notMerged)}</Text>
        </View>
      )}
      {summary === null || summary === "" ? (
        <Text style={styles.muted}>{detail.isLoading ? "Loading the delivery…" : "No delivery summary recorded."}</Text>
      ) : (
        <Markdown source={summary} theme={theme} onOpenLink={openLink} />
      )}
      {evidence === null ? null : (
        <>
          <View style={styles.rule} />
          <Text style={styles.section}>EVIDENCE</Text>
          <EvidenceBlock evidence={evidence} theme={theme} layout="lines" />
        </>
      )}
      {/* The evidence names what is missing itself; until it loads, the card's summary does. */}
      {ready || evidence !== null || card.evidence === null ? null : <Text style={[styles.muted, { color: colors.statusWarning }]}>{evidenceSummary(card.evidence)}</Text>}
      <View style={styles.rule} />
      <View ref={foot} collapsable={false} style={writing ? styles.writing : styles.foot}>
        {writing ? (
          <ChangeBox
              theme={theme}
              compact={compact}
              value={typed}
              onChangeText={setTyped}
              onFocus={reveal}
              placeholder="What should change?"
              canSend={typed.trim() !== ""}
              busy={busy}
              sendState={actions.stateOf("request-changes")}
              // Success closes the box, and the toast says it went.
              onSend={() =>
                actions.press("request-changes", () => changes({ project, ticket: card.id, text: typed.trim() }), {
                  success: "Sent to the owner.",
                  onSuccess: () => {
                    setTyped("");
                    setWriting(false);
                    onChangesSent?.();
                    onChanged();
                  },
                })
              }
              onCancel={() => setWriting(false)}
              background={colors.surface0}
            />
        ) : (
          <AcceptancePair
            theme={theme}
            busy={busy}
            acceptState={actions.stateOf("accept")}
            requestLabel="Request changes…"
            // The accepted ticket leaves this card, so Accept stays busy until it does.
            onAccept={ready ? () => actions.press("accept", () => accept({ project, ticket: card.id }), { after: "hold", success: `Accepted ${card.id}.`, onSuccess: onChanged }) : null}
            onRequestChanges={() => setWriting(true)}
          />
        )}
      </View>
    </View>
  );
}

/**
 * Accept in the row at the composer while the card is scrolled away (TR-131): the card's Accept, drawn
 * as the row's Show beside it is, so the two match.
 */
export function AcceptNow({ card, project, theme, onChanged }: { card: Card; project: string; theme: PluginTheme; onChanged: () => void }) {
  const accept = useRpc(acceptTicket);
  const actions = useActions();
  const { colors } = theme;
  const state = actions.stateOf("accept");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Accept ${card.id}`}
      accessibilityState={{ disabled: actions.busy, busy: state === "busy" }}
      disabled={actions.busy}
      // The accepted ticket leaves this row, so Accept stays busy until it does.
      onPress={() => actions.press("accept", () => accept({ project, ticket: card.id }), { after: "hold", success: `Accepted ${card.id}.`, onSuccess: onChanged })}
      style={[rowButtonStyle(colors), { flexDirection: "row", alignItems: "center", gap: SPACE.xs }]}
    >
      {state === "busy" ? <Spinner size={11} color={colors.accent} /> : <Icon name="Check" size={11} color={colors.accent} />}
      <Text style={{ color: colors.accent, fontSize: FONT_SIZE.caption, lineHeight: labelLineHeightFor(FONT_SIZE.caption), fontWeight: "600" }}>Accept</Text>
    </Pressable>
  );
}
