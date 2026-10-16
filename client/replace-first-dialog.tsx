/**
 * Asked while Replace manager is offered (TR-161): a press on Catch up, Compact, a suggestion or Send
 * would make the idle manager reread its whole context uncached, so it first recommends replacing,
 * with a way to go ahead anyway. Closing it does neither and keeps the composer's words.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";

import { REPLACE_MANAGER_LABEL, replaceFirstDialog, type ReplaceFirstAction } from "../shared/manager-actions";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton } from "./ui";

export function ReplaceFirstDialog({
  asked,
  tokens,
  theme,
  onReplace,
  onGoAhead,
  onClose,
}: {
  /** The press waiting on an answer; null while closed. */
  asked: ReplaceFirstAction | null;
  /** The context as the meter writes it ("142k"). */
  tokens: string;
  theme: PluginTheme;
  onReplace: () => void;
  onGoAhead: () => void;
  onClose: () => void;
}) {
  const words = replaceFirstDialog(asked ?? "send", tokens);
  return (
    <Modal
      title={words.title}
      open={asked !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content contentContainerStyle={{ padding: SPACE.lg, gap: SPACE.lg }}>
        <Text style={{ color: theme.colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) }}>{words.body}</Text>
        {/* The recommendation first and filled, as Accept is on a delivery card; each takes half the row and wraps to full width when narrow. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm }}>
          <IconButton icon="RefreshCw" label={REPLACE_MANAGER_LABEL} showLabel grow tone="accent" theme={theme} onPress={onReplace} />
          <IconButton icon={null} label={words.goAhead} showLabel grow theme={theme} onPress={onGoAhead} />
        </View>
      </Modal.Content>
    </Modal>
  );
}
