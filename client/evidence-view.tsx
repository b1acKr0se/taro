/**
 * The judged evidence of a ticket (TR-021): its checks, the review outcome, small screenshots and,
 * when incomplete, what is missing. No border, padding or heading of its own: the caller places it.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";

import type { EvidenceView } from "../shared/contracts";
import { ImageThumbnail } from "./image-view";
import { SPACE } from "./spacing";
import { FONT_SIZE } from "./type-scale";

const SCREENSHOT_HEIGHT = 72;

export function EvidenceBlock({ evidence, theme, thumbnailHeight = SCREENSHOT_HEIGHT }: { evidence: EvidenceView; theme: PluginTheme; thumbnailHeight?: number }) {
  const { colors } = theme;
  const text = { color: colors.foreground, fontSize: FONT_SIZE.small };
  const muted = { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption };
  return (
    <View style={{ gap: SPACE.xs }}>
      {evidence.checks.map((check, index) => (
        <Text key={index} numberOfLines={1} style={text}>
          {check.command} — {check.result}
        </Text>
      ))}
      {evidence.review === null ? null : (
        <Text numberOfLines={1} style={text}>
          Review: {evidence.review}
        </Text>
      )}
      {evidence.screenshots.length === 0 && evidence.screenshotsNone !== null ? (
        <Text numberOfLines={1} style={muted}>
          No screenshots: {evidence.screenshotsNone}
        </Text>
      ) : null}
      {evidence.screenshots.length === 0 ? null : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm }}>
          {evidence.screenshots.map((shot) => (
            <View key={shot.file} style={{ gap: SPACE.xxs, maxWidth: thumbnailHeight * 2 }}>
              {shot.present ? (
                <ImageThumbnail source={shot.path} alt={shot.caption === "" ? shot.file : shot.caption} theme={theme} height={thumbnailHeight} />
              ) : (
                <Text style={{ color: colors.statusDanger, fontSize: FONT_SIZE.caption }}>{shot.file} (missing)</Text>
              )}
              {shot.caption === "" ? null : (
                <Text numberOfLines={1} style={muted}>
                  {shot.caption}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
      {evidence.complete ? null : (
        <Text style={{ color: colors.statusWarning, fontSize: FONT_SIZE.small }}>Evidence missing: {evidence.missing.join("; ")}</Text>
      )}
    </View>
  );
}
