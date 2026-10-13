/**
 * A delivered ticket's Accept / Request changes, in a row at the owner's composer (TR-026): nothing
 * is pinned above the chat. Request changes sends what the user typed in the composer; Delivery
 * opens the PR, the delivery summary and the evidence over the bottom of the chat. While the evidence
 * is incomplete Accept is withheld (the server refuses it too) and the row names what is missing.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { acceptTicket, loadTicket, requestChanges, type Card } from "../shared/contracts";
import { evidenceSummary } from "../shared/evidence";
import { acceptanceReady } from "./card-calls";
import { drafts } from "./draft";
import { errorText, pullRequestLabel } from "./format";
import { Markdown } from "./markdown";
import { SPACE } from "./spacing";
import { FONT_SIZE } from "./type-scale";
import { IconButton } from "./ui";

/** The Delivery view covers at most this much of the chat, then scrolls. */
const DELIVERY_HEIGHT = 300;
const DELIVERY_HEIGHT_COMPACT = 220;

export function AcceptanceRow({
  card,
  project,
  agentId,
  theme,
  compact,
  evidence = null,
  trailing = null,
  onChanged,
}: {
  card: Card;
  project: string;
  /** The owner whose composer this row sits on: its draft is the change request. */
  agentId: string;
  theme: PluginTheme;
  compact: boolean;
  /** The ticket's evidence (TR-021), drawn in the Delivery view; nothing until it exists. */
  evidence?: ReactNode | null;
  /** Drawn at the end of the row (the context meter). */
  trailing?: ReactNode | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const load = useRpc(loadTicket);
  const accept = useRpc(acceptTicket);
  const changes = useRpc(requestChanges);
  // The same query as the Ticket tab, so the two share one fetch.
  const detail = useQuery({ queryKey: ["taro", "ticket", project, card.id], queryFn: () => load({ project, ticket: card.id }), refetchInterval: 6_000 });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(() => drafts.get(agentId));
  const { colors } = theme;
  const summary = detail.data?.finalSummary ?? null;
  const ready = acceptanceReady(card);
  const changeText = draft.trim();
  const openLink = (url: string) => void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));

  useEffect(() => {
    const reread = () => setDraft(drafts.get(agentId));
    const stop = drafts.subscribe(reread);
    reread();
    return stop;
  }, [agentId]);

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
    <View style={{ width: "100%", gap: SPACE.sm }}>
      {open ? (
        <ScrollView
          style={{ maxHeight: compact ? DELIVERY_HEIGHT_COMPACT : DELIVERY_HEIGHT, borderWidth: 1, borderColor: colors.accent, borderRadius: 10, backgroundColor: colors.surface1 }}
          contentContainerStyle={{ padding: SPACE.md, gap: SPACE.sm }}
        >
          {card.pullRequest === null ? null : (
            <Pressable accessibilityRole="link" onPress={() => openLink(card.pullRequest ?? "")} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
              <Icon name="GitPullRequest" size={12} color={colors.accent} />
              <Text style={{ color: colors.accent, fontSize: FONT_SIZE.caption }}>{pullRequestLabel(card.pullRequest)}</Text>
            </Pressable>
          )}
          {summary === null ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>{detail.isLoading ? "Loading the delivery…" : "No delivery summary recorded."}</Text>
          ) : (
            <Markdown source={summary} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={openLink} />
          )}
          {evidence}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm }}>
        <Icon name={ready ? "PackageCheck" : "PackageX"} size={14} color={ready ? colors.accent : colors.statusWarning} />
        <Text style={{ color: ready ? colors.accent : colors.statusWarning, fontSize: FONT_SIZE.micro, fontWeight: "700", letterSpacing: 0.5 }}>{ready ? "READY TO ACCEPT" : "NOT READY TO ACCEPT"}</Text>
        <IconButton icon={open ? "ChevronDown" : "ChevronUp"} label="Delivery" showLabel theme={theme} onPress={() => setOpen((value) => !value)} />
        {ready || card.evidence === null ? null : (
          <Text style={{ flexShrink: 1, color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }} numberOfLines={2}>
            {evidenceSummary(card.evidence)}
          </Text>
        )}
        <View style={{ flex: 1 }} />
        {ready ? (
          <IconButton icon="Check" label="Accept" showLabel tone="accent" theme={theme} disabled={busy} onPress={() => void run(() => accept({ project, ticket: card.id }), `Accepted ${card.id}.`)} />
        ) : null}
        <IconButton
          icon="MessageSquare"
          label="Request changes"
          showLabel
          theme={theme}
          disabled={busy || changeText === ""}
          onPress={() =>
            void run(async () => {
              await changes({ project, ticket: card.id, text: changeText });
              drafts.set(agentId, "");
            }, "Sent to the owner.")
          }
        />
        {trailing}
      </View>
    </View>
  );
}
