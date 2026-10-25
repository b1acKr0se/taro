/**
 * A plan's mockups (TR-235): a row per image, a thumbnail that opens the full-size view beside what
 * changes on that screen; `none — why` as a line. Shown in the plan card and in View plan, so the user
 * sees what would change before approving.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";

import type { MockupsView } from "../shared/contracts";
import { ImageThumbnail } from "./image-view";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

const MOCKUP_HEIGHT = 72;
/** The thumbnails' column: a desktop shot at the row's height fills it, a phone shot sits centred in it. */
const MOCKUP_COLUMN = MOCKUP_HEIGHT * 1.6;

/** `stacked`: the description under its thumbnail, for a column too narrow to hold both side by side (the board's cards). */
export function MockupList({ mockups, theme, limit = null, stacked = false }: { mockups: MockupsView; theme: PluginTheme; limit?: number | null; stacked?: boolean }) {
  const { colors } = theme;
  const text = { color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) };
  if (mockups.images.length === 0) {
    return <Text style={[text, { color: colors.foregroundMuted }]}>{mockups.none === null || mockups.none === "" ? "No UI change." : `No UI change: ${mockups.none}`}</Text>;
  }
  // The images that exist, the set each one's full-size view moves through.
  const gallery = mockups.images.filter((image) => image.present).map((image) => ({ source: image.path, alt: image.description === "" ? image.file : image.description }));
  const shown = limit === null ? mockups.images : mockups.images.slice(0, limit);
  return (
    <View style={{ gap: SPACE.sm }}>
      {shown.map((image) => (
        <View key={image.file} style={stacked ? { gap: SPACE.xs } : { flexDirection: "row", alignItems: "center", gap: SPACE.md }}>
          <View style={stacked ? { alignItems: "flex-start" } : { width: MOCKUP_COLUMN, alignItems: "center" }}>
            {image.present ? (
              <ImageThumbnail
                source={image.path}
                alt={image.description === "" ? image.file : image.description}
                theme={theme}
                height={MOCKUP_HEIGHT}
                set={gallery}
                index={gallery.findIndex((each) => each.source === image.path)}
              />
            ) : (
              <Text style={{ color: colors.statusDanger, fontSize: FONT_SIZE.caption, textAlign: "center" }}>missing</Text>
            )}
          </View>
          <Text style={[text, stacked ? null : { flex: 1, minWidth: 0 }]}>{image.description}</Text>
        </View>
      ))}
      {limit !== null && mockups.images.length > limit ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.caption }}>+{mockups.images.length - limit} more in the plan</Text>
      ) : null}
    </View>
  );
}
