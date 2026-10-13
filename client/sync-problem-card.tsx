/**
 * Paused ticket sync as a Needs you item (decision 31): what went wrong, the
 * tickets changed on both sides, and the ways out — keep this machine's or the
 * remote's version where both changed the same lines, or retry after fixing it
 * elsewhere. Edits that do not overlap are kept from both sides either way.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { resolveTrackerSync, type SyncResolution, type TrackerSyncProblem } from "../shared/contracts";
import { errorText } from "./format";
import { useRefreshProjects } from "./queries";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

interface Choice {
  resolution: SyncResolution;
  label: string;
  consequence: string;
}

const CONFLICT_CHOICES: readonly Choice[] = [
  { resolution: "keep-local", label: "Keep this machine's version", consequence: "where both changed the same lines; then push" },
  { resolution: "keep-remote", label: "Keep the remote's version", consequence: "where both changed the same lines; then push" },
  { resolution: "retry", label: "Retry", consequence: "after fixing it on the other machine" },
];

const FAILURE_CHOICES: readonly Choice[] = [{ resolution: "retry", label: "Retry", consequence: "after fixing the remote or the network" }];

export function SyncProblemCard({
  project,
  problem,
  theme,
  compact,
  onOpenTicket,
}: {
  project: string;
  problem: TrackerSyncProblem;
  theme: PluginTheme;
  compact: boolean;
  /** Opens a ticket named in the conflict; null where tickets cannot be opened. */
  onOpenTicket: ((ticket: string) => void) | null;
}) {
  const toast = useToast();
  const resolve = useRpc(resolveTrackerSync);
  const refreshProjects = useRefreshProjects();
  const [busy, setBusy] = useState(false);
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      card: { borderWidth: 1, borderColor: colors.statusWarning, borderRadius: 10, padding: compact ? 10 : 12, gap: 8, backgroundColor: colors.surface1 },
      heading: { color: colors.statusWarning, fontSize: FONT_SIZE.micro, fontWeight: "700" as const, letterSpacing: 0.5 },
      message: { color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" as const, lineHeight: lineHeightFor(FONT_SIZE.body) },
      note: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
      tickets: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      ticket: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
      ticketText: { color: colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
      options: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      option: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, maxWidth: "100%" as const, flexShrink: 1 },
      optionLabel: { color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "600" as const },
      consequence: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
    }),
    [colors, compact],
  );

  async function choose(choice: Choice): Promise<void> {
    setBusy(true);
    try {
      const { problem: left } = await resolve({ project, resolution: choice.resolution });
      if (left === null) toast.show("Tickets are in sync with the remote again.", { variant: "success" });
      else toast.error(`Still paused: ${left.message}`);
    } catch (caught) {
      toast.error(errorText(caught));
    } finally {
      setBusy(false);
      refreshProjects();
    }
  }

  const conflict = problem.kind === "conflict";
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>TICKET SYNC PAUSED · {project.toUpperCase()}</Text>
      <Text style={styles.message}>{problem.message}</Text>
      <Text style={styles.note}>
        {conflict
          ? "Tickets are still saved here; they stop going to the remote until you choose. Edits that do not overlap are kept from both sides."
          : "Tickets are still saved here; they stop going to the remote until it works again."}
      </Text>
      {problem.tickets.length === 0 ? null : (
        <View style={styles.tickets}>
          {problem.tickets.map((ticket) => (
            <Pressable key={ticket} accessibilityRole="button" disabled={onOpenTicket === null} style={styles.ticket} onPress={() => onOpenTicket?.(ticket)}>
              <Text style={styles.ticketText}>{ticket}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.options}>
        {(conflict ? CONFLICT_CHOICES : FAILURE_CHOICES).map((choice) => (
          <Pressable key={choice.resolution} accessibilityRole="button" disabled={busy} style={styles.option} onPress={() => void choose(choice)}>
            <Text style={styles.optionLabel}>{choice.label}</Text>
            <Text style={styles.consequence}>{choice.consequence}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
