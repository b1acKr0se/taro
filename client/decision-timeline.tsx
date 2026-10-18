/**
 * Decision blocks drawn as cards inside Paseo's own agent tab (TR-014). The
 * transformer turns a finished message holding a block into its text and its
 * blocks; these renderers draw them, the block as the Taro screen's card while
 * Taro holds it open and as a short note once it is settled.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { z } from "zod";

import { getDecision } from "../shared/contracts";
import { decisionBlockView, SCOPE_APPROVAL, untrackedDecision } from "../shared/decision-view";
import { ParsedDecisionSchema, type ParsedDecision } from "../shared/reports";
import { DecisionCard } from "./decision-card";
import { FinishedCard } from "./finished-card";
import { blockCardSubject, storedDecisionView, type FinishedView } from "./finished-cards";
import { errorText, formatClock } from "./format";
import { Markdown } from "./markdown";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

export const DecisionTextSchema = z.object({ text: z.string() });
export const DecisionBlockSchema = z.object({ decision: ParsedDecisionSchema });

export function DecisionTextItem({ item, theme }: PluginTimelineItemProps<z.output<typeof DecisionTextSchema>>) {
  const toast = useToast();
  return <Markdown source={item.data.text} theme={theme} onOpenLink={(url) => void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)))} />;
}

export function DecisionBlockItem({ agentId, item, theme, layout }: PluginTimelineItemProps<z.output<typeof DecisionBlockSchema>>) {
  const block = item.data.decision;
  const get = useRpc(getDecision);
  const lookup = useQuery({
    queryKey: ["taro", "decision", agentId, block.id],
    queryFn: () => get({ agentId, id: block.id }),
    enabled: !block.withdrawn,
    // A settled decision does not change again; an open or not yet recorded one may.
    refetchInterval: (query) => (query.state.data?.decision?.status === "answered" || query.state.data?.decision?.status === "withdrawn" ? false : 4_000),
  });
  const view = decisionBlockView(
    block,
    lookup.data !== undefined ? { state: "done", decision: lookup.data.decision, agentLive: lookup.data.agentLive } : lookup.isError ? { state: "error" } : { state: "loading" },
  );

  switch (view.kind) {
    case "open":
      return <DecisionCard decision={view.decision} theme={theme} compact={layout.compact} answeredFrom="tab" onAnswered={() => void lookup.refetch()} />;
    case "read-only":
      return <DecisionCard decision={untrackedDecision(block, agentId)} theme={theme} compact={layout.compact} onAnswered={() => undefined} readOnlyNote={view.note} />;
    case "answered":
    case "withdrawn":
    case "replaced": {
      // The stored decision says how it ended; a withdrawn view with none stored (its agent went away) still reads Withdrawn.
      const stored = lookup.data?.decision ?? null;
      const ended: FinishedView | null = view.kind === "replaced" ? { outcome: "Asked again below", tone: "neutral", time: null, words: null } : stored === null ? null : storedDecisionView(stored, formatClock);
      const outcome = ended ?? { outcome: "Withdrawn", tone: "neutral" as const, time: null, words: null };
      const plan = block.id === SCOPE_APPROVAL;
      return (
        <FinishedCard
          theme={theme}
          lead={plan ? null : "Question"}
          subject={blockCardSubject(block, stored?.ticket ?? null)}
          outcome={outcome.outcome}
          tone={outcome.tone}
          time={outcome.time}
          answer={outcome.answer ?? null}
          words={outcome.words}
        />
      );
    }
    case "withdrawal":
      return <Settled block={block} theme={theme} note={`Withdrew decision “${block.id}”`} />;
  }
}

/** A decision that needs nothing more: its question and what became of it. */
function Settled({ block, theme, note }: { block: ParsedDecision; theme: PluginTheme; note: string }) {
  const { colors } = theme;
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}>
      {block.withdrawn ? null : <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) }}>{block.question}</Text>}
      <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "600" }}>{note}</Text>
    </View>
  );
}
