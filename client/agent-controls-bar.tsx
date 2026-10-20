/**
 * The composer's model and effort, drawn as Paseo's composer draws its own toolbar controls: the
 * provider's mark and the model's name, then a brain and the effort, each a 28px pill of muted
 * text (`AgentControlTrigger`, `surface="toolbar"`). Ported from Paseo (v0.11.2, Apache-2.0):
 * `packages/app/src/composer/agent-controls/control.tsx`. Read-only for now: Paseo's pickers
 * switch the model, which Taro leaves to Paseo's own tab (TR-174 plans it here).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Image, Text, View } from "react-native";

import { effortOf, modelName, thinkingLabel } from "../shared/agent-controls";
import { PROVIDER_ICON_PNG } from "./provider-icon-data";
import { useModels } from "./queries";
import { SPACE } from "./spacing";
import { FONT_SIZE } from "./type-scale";

/** Paseo's toolbar glyph and control heights. */
const GLYPH_SIZE = 16;
const CONTROL_HEIGHT = 28;

export interface AgentIdentity {
  provider: string;
  model: string | null;
  thinking: string | null;
}

function ProviderGlyph({ provider, color }: { provider: string; color: string }) {
  const png = PROVIDER_ICON_PNG[provider];
  // A provider Paseo draws no mark for gets its Bot, as in Paseo.
  if (png === undefined) return <Icon name="Bot" size={GLYPH_SIZE} color={color} />;
  return <Image source={{ uri: `data:image/png;base64,${png}` }} style={{ width: GLYPH_SIZE, height: GLYPH_SIZE, tintColor: color }} accessibilityIgnoresInvertColors />;
}

export function AgentControlsBar({ theme, agent }: { theme: PluginTheme; agent: AgentIdentity }) {
  const models = useModels();
  // Not drawn before the model list arrives, or the raw id would flash before the name.
  if (models.query.isLoading) return null;
  const muted = theme.colors.foregroundMuted;
  const name = modelName(models.options, agent) ?? agent.provider;
  const chosen = effortOf(models.options, agent);
  const effort = chosen === null ? null : thinkingLabel(chosen);
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
