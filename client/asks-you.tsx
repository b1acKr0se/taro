/**
 * What an agent asks of the user, pinned above its chat (TR-022): its open decisions, and for a
 * delivered ticket the acceptance panel. The board only names these in one line; they are answered
 * here, beside the conversation that explains them. Folds to its heading.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { acceptTicket, loadTicket, requestChanges, type Card } from "../shared/contracts";
import type { StoredDecision } from "../shared/state";
import { DecisionCard } from "./decision-card";
import { errorText, pullRequestLabel } from "./format";
import { Markdown } from "./markdown";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton } from "./ui";
import { walkOrder } from "./walk-order";

/** The delivery summary shows about this many pixels until "more". */
const SUMMARY_FOLD_HEIGHT = 88;

export function AsksYou({
  decisions,
  acceptance,
  theme,
  compact,
  onChanged,
}: {
  decisions: readonly StoredDecision[];
  /** The acceptance panel, when the ticket waits for it. */
  acceptance: ReactNode | null;
  theme: PluginTheme;
  compact: boolean;
  onChanged: () => void;
}) {
  const [folded, setFolded] = useState(false);
  const ordered = useMemo(() => walkOrder(decisions), [decisions]);
  const { colors } = theme;
  const count = ordered.length + (acceptance === null ? 0 : 1);
  if (count === 0) return null;
  const blocking = acceptance !== null || ordered.some((decision) => decision.blocking);
  const color = blocking ? colors.statusWarning : colors.foregroundMuted;
  const inset = compact ? SPACE.md : SPACE.lg;
  return (
    // At most about half the pane, so the conversation that explains the question stays in view.
    <View style={{ maxHeight: "55%", borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !folded }}
        onPress={() => setFolded((value) => !value)}
        style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingHorizontal: inset, paddingVertical: SPACE.sm }}
      >
        <Icon name="Hand" size={14} color={color} />
        <Text style={{ flex: 1, color, fontSize: FONT_SIZE.micro, fontWeight: "700", letterSpacing: 0.5 }}>ASKS YOU · {count}</Text>
        <Icon name={folded ? "ChevronDown" : "ChevronUp"} size={14} color={colors.foregroundMuted} />
      </Pressable>
      {folded ? null : (
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingHorizontal: inset, paddingBottom: SPACE.md, gap: SPACE.sm }}>
          {acceptance}
          {ordered.map((decision) => (
            <DecisionCard key={decision.key} decision={decision} theme={theme} compact={compact} onAnswered={onChanged} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * A delivered ticket: what was delivered, its evidence, and Accept / Request changes…. `evidence`
 * is the room TR-021 fills (check summaries, the review outcome, screenshots); nothing shows there
 * until then.
 */
export function AcceptancePanel({
  card,
  project,
  theme,
  compact,
  evidence = null,
  onChanged,
}: {
  card: Card;
  project: string;
  theme: PluginTheme;
  compact: boolean;
  evidence?: ReactNode | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const load = useRpc(loadTicket);
  const accept = useRpc(acceptTicket);
  const changes = useRpc(requestChanges);
  // The same query as the Ticket tab, so the two share one fetch.
  const detail = useQuery({ queryKey: ["taro", "ticket", project, card.id], queryFn: () => load({ project, ticket: card.id }), refetchInterval: 6_000 });
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [changeText, setChangeText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { colors } = theme;
  const summary = detail.data?.finalSummary ?? null;
  const openLink = (url: string) => void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));

  async function run(action: () => Promise<unknown>, done: string): Promise<void> {
    setBusy(true);
    try {
      await action();
      toast.show(done, { variant: "success" });
      onChanged();
    } catch (caught) {
      toast.error(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ borderWidth: 1, borderColor: colors.accent, borderRadius: 10, padding: compact ? SPACE.md : SPACE.md + 2, gap: SPACE.sm, backgroundColor: colors.surface1 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm }}>
        <Icon name="PackageCheck" size={14} color={colors.accent} />
        <Text style={{ color: colors.accent, fontSize: FONT_SIZE.micro, fontWeight: "700", letterSpacing: 0.5 }}>READY TO ACCEPT</Text>
        {card.pullRequest === null ? null : (
          <Pressable accessibilityRole="link" onPress={() => openLink(card.pullRequest ?? "")} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
            <Icon name="GitPullRequest" size={12} color={colors.accent} />
            <Text style={{ color: colors.accent, fontSize: FONT_SIZE.caption }}>{pullRequestLabel(card.pullRequest)}</Text>
          </Pressable>
        )}
      </View>
      {summary === null ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>{detail.isLoading ? "Loading the delivery…" : "No delivery summary recorded."}</Text>
      ) : (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: summaryOpen }} onPress={() => setSummaryOpen((open) => !open)}>
          <View style={{ maxHeight: summaryOpen ? undefined : SUMMARY_FOLD_HEIGHT, overflow: "hidden" }}>
            <Markdown source={summary} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
          </View>
          <Text style={{ color: colors.accent, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) }}>{summaryOpen ? "less" : "full delivery"}</Text>
        </Pressable>
      )}
      {evidence}
      {changeText === null ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm }}>
          <IconButton icon="Check" label="Accept" showLabel tone="accent" theme={theme} disabled={busy} onPress={() => void run(() => accept({ project, ticket: card.id }), `Accepted ${card.id}.`)} />
          <IconButton icon="MessageSquare" label="Request changes…" showLabel theme={theme} disabled={busy} onPress={() => setChangeText("")} />
        </View>
      ) : (
        <View style={{ gap: SPACE.sm }}>
          <TextInput
            value={changeText}
            onChangeText={setChangeText}
            placeholder="What should change?"
            placeholderTextColor={colors.foregroundMuted}
            multiline
            style={{
              color: colors.foreground,
              fontSize: FONT_SIZE.small,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: SPACE.md,
              paddingVertical: SPACE.sm,
              minHeight: 60,
              backgroundColor: colors.surface0,
              textAlignVertical: "top",
            }}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm }}>
            <IconButton
              icon="Send"
              label="Send changes"
              showLabel
              tone="accent"
              theme={theme}
              disabled={busy || changeText.trim() === ""}
              onPress={() =>
                void run(async () => {
                  await changes({ project, ticket: card.id, text: changeText });
                  setChangeText(null);
                }, "Sent to the owner.")
              }
            />
            <IconButton icon="X" label="Cancel" showLabel theme={theme} onPress={() => setChangeText(null)} />
          </View>
        </View>
      )}
    </View>
  );
}
