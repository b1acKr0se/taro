/**
 * The judged evidence of a ticket (TR-021): its checks, the review outcome, a row per screenshot (a
 * small thumbnail beside its whole caption and file name, TR-055) and, when incomplete, what is
 * missing. No border, padding or heading of its own: the caller places it
 * (the Ticket tab's Evidence section, the acceptance card in the owner's chat). The Ticket tab shows
 * the first few screenshots and folds the rest behind "+N more" (TR-061).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";

import { loadTicket, type EvidenceView } from "../shared/contracts";
import { foldList } from "../shared/ticket-summary";
import { Pressable } from "./focus";
import { ImageThumbnail } from "./image-view";
import { MONOSPACE } from "./ui";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

const SCREENSHOT_HEIGHT = 64;
/** The thumbnails' column: a desktop shot at the row's height fills it, a phone shot sits centred in it. */
const SCREENSHOT_COLUMN = SCREENSHOT_HEIGHT * 1.6;

/**
 * A ticket's evidence, read with the same query as the Ticket tab (so the two share one fetch); nothing
 * while it loads or when the ticket has none. `inline` puts the checks and the review on one line.
 */
export function Evidence({ project, ticket, theme, layout = "inline" }: { project: string; ticket: string; theme: PluginTheme; layout?: "inline" | "lines" }) {
  const load = useRpc(loadTicket);
  const detail = useQuery({ queryKey: ["taro", "ticket", project, ticket], queryFn: () => load({ project, ticket }), refetchInterval: 6_000 });
  const evidence = detail.data?.evidence ?? null;
  return evidence === null ? null : <EvidenceBlock evidence={evidence} theme={theme} layout={layout} />;
}

export function EvidenceBlock({
  evidence,
  theme,
  layout = "lines",
  screenshotLimit = null,
}: {
  evidence: EvidenceView;
  theme: PluginTheme;
  /** Show this many screenshots, the rest behind "+N more"; all of them when null. */
  screenshotLimit?: number | null;
  /** `lines`: a line per check, wrapped whole (the Ticket tab, the acceptance card); `inline`: checks and review on two lines at most. */
  layout?: "inline" | "lines";
}) {
  const [allShots, setAllShots] = useState(false);
  const shots = foldList(evidence.screenshots, screenshotLimit ?? evidence.screenshots.length, allShots);
  const { colors } = theme;
  const text = { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) };
  const muted = { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) };
  // The screenshots that exist, the set each one's enlarged view moves through.
  const gallery = evidence.screenshots.filter((shot) => shot.present).map((shot) => ({ source: shot.path, alt: shot.caption === "" ? shot.file : shot.caption }));
  const inline = [...evidence.checks.map((check) => `✓ ${check.command} — ${check.result}`), ...(evidence.review === null ? [] : [`review: ${evidence.review}`])];
  return (
    <View style={{ gap: layout === "lines" ? SPACE.sm : SPACE.xs }}>
      {layout === "inline" ? (
        inline.length === 0 ? null : (
          <Text numberOfLines={2} style={text}>
            {inline.join(" · ")}
          </Text>
        )
      ) : (
        <>
          {evidence.checks.map((check, index) => (
            <Text key={index} style={text}>
              {check.command} — {check.result}
            </Text>
          ))}
          {evidence.review === null ? null : (
            <Text style={text}>
              Review: {evidence.review}
            </Text>
          )}
          {evidence.ux === null ? null : (
            <Text style={text}>
              Visual check: {evidence.ux}
            </Text>
          )}
        </>
      )}
      {evidence.screenshots.length === 0 && evidence.screenshotsNone !== null ? (
        <Text style={muted}>
          No screenshots: {evidence.screenshotsNone}
        </Text>
      ) : null}
      {evidence.screenshots.length === 0 ? null : (
        <View style={{ gap: SPACE.sm }}>
          {shots.shown.map((shot) => (
            <View key={shot.file} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.md }}>
              <View style={{ width: SCREENSHOT_COLUMN, alignItems: "center" }}>
                {shot.present ? (
                  <ImageThumbnail
                    source={shot.path}
                    alt={shot.caption === "" ? shot.file : shot.caption}
                    theme={theme}
                    height={SCREENSHOT_HEIGHT}
                    set={gallery}
                    index={gallery.findIndex((each) => each.source === shot.path)}
                  />
                ) : (
                  <Text style={{ color: colors.statusDanger, fontSize: FONT_SIZE.caption, textAlign: "center" }}>missing</Text>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: SPACE.xxs }}>
                {shot.caption === "" ? null : <Text style={text}>{shot.caption}</Text>}
                <Text style={[muted, { fontFamily: MONOSPACE }]}>{shot.file}</Text>
              </View>
            </View>
          ))}
          {shots.hidden === 0 ? null : (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: false }} onPress={() => setAllShots(true)} style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
              <Icon name="Plus" size={13} color={colors.accent} />
              <Text style={{ color: colors.accent, fontSize: FONT_SIZE.small, fontWeight: "600" }}>
                {shots.hidden} more {shots.hidden === 1 ? "screenshot" : "screenshots"}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {evidence.complete ? null : (
        <Text style={{ color: colors.statusWarning, fontSize: FONT_SIZE.small }}>Evidence missing: {evidence.missing.join("; ")}</Text>
      )}
    </View>
  );
}
