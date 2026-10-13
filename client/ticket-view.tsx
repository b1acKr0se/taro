/** The ticket beside its owner's chat: status, criteria, plan, records, final summary. */
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";

import { loadTicket } from "../shared/contracts";
import { errorText } from "./format";
import { Markdown } from "./markdown";
import { FONT_SIZE } from "./type-scale";

export function TicketView({ project, ticket, theme }: { project: string; ticket: string; theme: PluginTheme }) {
  const load = useRpc(loadTicket);
  const toast = useToast();
  const detail = useQuery({ queryKey: ["taro", "ticket", project, ticket], queryFn: () => load({ project, ticket }), refetchInterval: 6_000 });
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      body: { padding: 14, gap: 12 },
      heading: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, fontWeight: "700" as const, letterSpacing: 0.5 },
      text: { color: colors.foreground, fontSize: FONT_SIZE.small },
      muted: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small },
      notes: { color: colors.foreground, fontSize: FONT_SIZE.caption, fontFamily: "monospace" },
    }),
    [colors],
  );
  if (detail.error !== null && detail.data === undefined) return <Text style={[styles.muted, { padding: 14 }]}>{errorText(detail.error)}</Text>;
  const data = detail.data;
  if (data === undefined) return <Text style={[styles.muted, { padding: 14 }]}>Loading the ticket…</Text>;
  const noop = () => undefined;
  // The delivery names the PR; the user opens it from here before accepting (decision 34).
  const openLink = (url: string) => void openExternalUrl(url).catch((caught: unknown) => toast.error(errorText(caught)));
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.text}>
        {data.id} · {data.status}
        {data.labels.length === 0 ? "" : ` · ${data.labels.join(", ")}`}
      </Text>
      {data.description === null ? null : (
        <View style={{ gap: 4 }}>
          <Text style={styles.heading}>DESCRIPTION</Text>
          <Markdown source={data.description} theme={theme} onOpenLink={noop} />
        </View>
      )}
      {data.acceptanceCriteria.length === 0 ? null : (
        <View style={{ gap: 4 }}>
          <Text style={styles.heading}>ACCEPTANCE CRITERIA</Text>
          {data.acceptanceCriteria.map((criterion) => (
            <Text key={criterion.index} style={styles.text}>
              {criterion.checked ? "☑" : "☐"} {criterion.text}
            </Text>
          ))}
        </View>
      )}
      {data.plan === null ? null : (
        <View style={{ gap: 4 }}>
          <Text style={styles.heading}>PLAN</Text>
          <Markdown source={data.plan} theme={theme} onOpenLink={noop} />
        </View>
      )}
      {data.children.length === 0 ? null : (
        <View style={{ gap: 4 }}>
          <Text style={styles.heading}>CHILDREN</Text>
          {data.children.map((child) => (
            <Text key={child.id} style={styles.text}>
              {child.id} · {child.status ?? "?"} · {child.title}
            </Text>
          ))}
        </View>
      )}
      {data.finalSummary === null ? null : (
        <View style={{ gap: 4 }}>
          <Text style={styles.heading}>DELIVERY</Text>
          <Markdown source={data.finalSummary} theme={theme} onOpenLink={openLink} />
        </View>
      )}
      {data.notes === null ? null : (
        <View style={{ gap: 4 }}>
          <Text style={styles.heading}>RECORDS</Text>
          <Text selectable style={styles.notes}>
            {data.notes}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
