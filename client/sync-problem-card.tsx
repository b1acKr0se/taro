/**
 * Paused ticket sync as a Needs you item (decision 31): what went wrong, the
 * tickets changed on both sides, and the ways out — keep this machine's or the
 * remote's version where both changed the same lines, or retry after fixing it
 * elsewhere. Edits that do not overlap are kept from both sides either way.
 * On the board it starts folded to its heading and message (TR-022) and opens in place.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { resolveTrackerSync, type SyncResolution, type TrackerSyncProblem } from "../shared/contracts";
import { useRefreshProjects } from "./queries";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { Spinner } from "./ui";
import { useActions } from "./use-actions";

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
  startFolded = false,
}: {
  project: string;
  problem: TrackerSyncProblem;
  theme: PluginTheme;
  compact: boolean;
  /** Opens a ticket named in the conflict; null where tickets cannot be opened. */
  onOpenTicket: ((ticket: string) => void) | null;
  startFolded?: boolean;
}) {
  const toast = useToast();
  const resolve = useRpc(resolveTrackerSync);
  const refreshProjects = useRefreshProjects();
  const presses = useActions();
  const [folded, setFolded] = useState(startFolded);
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
      resolve: { color: colors.accent, fontSize: FONT_SIZE.caption, fontWeight: "600" as const },
    }),
    [colors, compact],
  );

  function choose(choice: Choice): void {
    presses.press(
      choice.resolution,
      async () => {
        try {
          return await resolve({ project, resolution: choice.resolution });
        } finally {
          refreshProjects();
        }
      },
      {
        onSuccess: ({ problem: left }) => {
          if (left === null) toast.show("Tickets are in sync with the remote again.", { variant: "success" });
          else toast.error(`Still paused: ${left.message}`);
        },
      },
    );
  }

  const conflict = problem.kind === "conflict";
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: !folded }} onPress={() => setFolded((value) => !value)} style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[styles.heading, { flex: 1 }]}>TICKET SYNC PAUSED · {project.toUpperCase()}</Text>
          <Text style={styles.resolve}>{folded ? "Resolve" : "Fold"}</Text>
          <Icon name={folded ? "ChevronDown" : "ChevronUp"} size={14} color={colors.accent} />
        </View>
        <Text style={styles.message} numberOfLines={folded ? 1 : undefined}>
          {problem.message}
        </Text>
      </Pressable>
      {folded ? null : (
        <>
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
              <Pressable
                key={choice.resolution}
                accessibilityRole="button"
                accessibilityState={{ busy: presses.stateOf(choice.resolution) === "busy", disabled: presses.busy }}
                disabled={presses.busy}
                style={[styles.option, presses.busy && presses.stateOf(choice.resolution) !== "busy" ? { opacity: 0.5 } : null]}
                onPress={() => choose(choice)}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
                  {presses.stateOf(choice.resolution) === "busy" ? (
                    <Spinner size={12} color={colors.foreground} />
                  ) : presses.stateOf(choice.resolution) === "done" ? (
                    <Icon name="Check" size={12} color={colors.statusSuccess} />
                  ) : null}
                  <Text style={styles.optionLabel}>{choice.label}</Text>
                </View>
                <Text style={styles.consequence}>{choice.consequence}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
