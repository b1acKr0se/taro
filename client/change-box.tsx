/**
 * The box a card's Request changes… opens in place of its buttons (TR-112): the field, then Send
 * changes and Cancel. The acceptance card and the plan card both draw it, so they ask alike.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { View } from "react-native";

import { refusedMessage } from "../shared/refused-commands";
import { ReplyBox } from "./reply-box";
import { SPACE } from "./spacing";
import { IconButton } from "./ui";

export function ChangeBox({
  theme,
  compact,
  value,
  onChangeText,
  onFocus,
  placeholder,
  sendLabel = "Send changes",
  canSend,
  busy,
  sendState,
  onSend,
  onCancel,
  background,
}: {
  theme: PluginTheme;
  /** A phone-sized layout; by default, a window narrower than Paseo's `md`. */
  compact?: boolean | undefined;
  value: string;
  onChangeText: (text: string) => void;
  /** Reveals the box and the buttons under it above a phone's keyboard. */
  onFocus: () => void;
  placeholder: string;
  sendLabel?: string;
  canSend: boolean;
  busy: boolean;
  sendState?: "busy" | "done" | undefined;
  onSend: () => void;
  /** Closes the box; the caller keeps the words for the next time it opens. */
  onCancel: () => void;
  /** surface0 inside a card that is surface1; the box's own default on a plain pane. */
  background?: string | undefined;
}) {
  const toast = useToast();
  const styles = useMemo(
    () => ({
      box: { gap: SPACE.sm },
      buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: SPACE.sm },
    }),
    [],
  );
  return (
    <View style={styles.box}>
      <ReplyBox theme={theme} compact={compact} value={value} onChangeText={onChangeText} onFocus={onFocus} placeholder={placeholder} autoFocus editable={!busy} background={background} />
      <View style={styles.buttons}>
        <IconButton icon="Send" label={sendLabel} showLabel tone="accent" theme={theme} disabled={busy || !canSend} state={sendState} onPress={() => {
            // Refused before the card's call starts, so Send never spins for it (TR-232).
            const refusal = refusedMessage(value);
            if (refusal === null) onSend();
            else toast.error(refusal);
          }} />
        <IconButton icon="X" label="Cancel" showLabel theme={theme} disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}
