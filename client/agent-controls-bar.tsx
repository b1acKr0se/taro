/**
 * The composer's model and effort, drawn as Paseo's composer draws its own toolbar controls: the
 * provider's mark and the model's name, then a brain and the effort, each a 28px pill of muted
 * text (`AgentControlTrigger`, `surface="toolbar"`). Ported from Paseo (v0.11.2, Apache-2.0):
 * `packages/app/src/composer/agent-controls/control.tsx`. Read-only for now: Paseo's pickers
 * switch the model, which Taro leaves to Paseo's own tab (TR-174 plans it here).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Image, Platform, Text, View } from "react-native";

import { controlLabels } from "../shared/agent-controls";
import { PROVIDER_ICON_PNG } from "./provider-icon-data";
import { useModels } from "./queries";
import { SPACE } from "./spacing";
import { FONT_SIZE } from "./type-scale";

/** Paseo's toolbar glyph and control heights. */
const GLYPH_SIZE = 16;
const CONTROL_HEIGHT = 28;
/** The phone composer's icons are 20px (`composerMetrics`). */
const PHONE_GLYPH_SIZE = 20;

export interface AgentIdentity {
  provider: string;
  model: string | null;
  thinking: string | null;
}

function ProviderGlyph({ provider, color, size = GLYPH_SIZE }: { provider: string; color: string; size?: number }) {
  const png = PROVIDER_ICON_PNG[provider];
  // A provider Paseo draws no mark for gets its Bot, as in Paseo.
  if (png === undefined) return <Icon name="Bot" size={size} color={color} />;
  return <Image source={{ uri: `data:image/png;base64,${png}` }} style={{ width: size, height: size, tintColor: color }} accessibilityIgnoresInvertColors />;
}

export function AgentControlsBar({ theme, agent }: { theme: PluginTheme; agent: AgentIdentity }) {
  const models = useModels();
  // Not drawn before the model list arrives, or the raw id would flash before the name.
  if (models.query.isLoading) return null;
  const muted = theme.colors.foregroundMuted;
  const { name, effort } = controlLabels(models.options, agent);
  // The phone app's composer (TR-209): the mark, the model in normal text and the effort dimmer, on
  // one line, with no pills or brain, as Paseo draws it there.
  if (Platform.OS !== "web") {
    return (
      <View accessible accessibilityLabel={effort === null ? `Model: ${name}` : `Model: ${name}, effort: ${effort}`} style={{ minWidth: 0, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingHorizontal: SPACE.sm }}>
        <ProviderGlyph provider={agent.provider} color={theme.colors.foreground} size={PHONE_GLYPH_SIZE} />
        <Text style={{ minWidth: 0, flexShrink: 1, color: theme.colors.foreground, fontSize: FONT_SIZE.body }} numberOfLines={1}>
          {name}
          {effort === null ? null : <Text style={{ color: muted }}>{` ${effort}`}</Text>}
        </Text>
      </View>
    );
  }
  const textStyle = { minWidth: 0, flexShrink: 1, color: muted, fontSize: FONT_SIZE.small };
  return (
    <View style={{ minWidth: 0, flexShrink: 1, flexDirection: "row", alignItems: "center" }}>
      <View accessible accessibilityLabel={`Model: ${name}`} style={{ height: CONTROL_HEIGHT, minWidth: 0, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: SPACE.xs, paddingHorizontal: SPACE.sm }}>
        <ProviderGlyph provider={agent.provider} color={muted} />
        <Text style={textStyle} numberOfLines={1}>
          {name}
        </Text>
      </View>
      {effort === null ? null : (
        <View accessible accessibilityLabel={`Effort: ${effort}`} style={{ height: CONTROL_HEIGHT, minWidth: 0, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: SPACE.xs, paddingHorizontal: SPACE.sm }}>
          <Icon name="Brain" size={GLYPH_SIZE} color={muted} />
          <Text style={textStyle} numberOfLines={1}>
            {effort}
          </Text>
        </View>
      )}
    </View>
  );
}
