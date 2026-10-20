/**
 * The footer under a finished turn's last reply (TR-202): a copy button and "Worked for 11s", which
 * swaps to the time the turn ended while hovered (web) or for a moment after a tap (phone).
 *
 * Ported from Paseo (5293dda, Apache-2.0): `AssistantTurnFooter` and `TurnCopyButton` from
 * `packages/app/src/components/message.tsx`. Changed: no fork menu, plain text on the clipboard
 * (`clipboard.ts`), and the theme comes as a prop as everywhere in Taro.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";

import { copyText } from "./clipboard";
import { Pressable } from "./focus";
import { SPACE } from "./spacing";
import { FONT_SIZE } from "./type-scale";
import type { TurnFooter } from "./transcript-rows";
import { footerLabels } from "./turn-time";

const WEB = Platform.OS === "web";
/** How long a tap keeps the end time showing, and the check shows after a copy. */
const TIMESTAMP_REVEAL_MS = 3000;
const COPIED_MS = 1500;
const ICON_SIZE = 14;

export function TurnFooterView({ turn, theme }: { turn: TurnFooter; theme: PluginTheme }) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [overCopy, setOverCopy] = useState(false);
  const [pressedReveal, setPressedReveal] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      if (revealTimer.current !== null) clearTimeout(revealTimer.current);
    },
    [],
  );

  const { duration, endedAt } = footerLabels(turn);
  const primary = duration || endedAt;
  const canSwap = duration !== "" && endedAt !== "";
  const showEnd = canSwap && (WEB ? hovered : pressedReveal);

  const copy = () => {
    if (turn.copyText === "") return;
    void copyText(globalThis, turn.copyText).then((done) => {
      if (!done) return;
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  };
  const reveal = () => {
    if (WEB || !canSwap) return;
    if (revealTimer.current !== null) clearTimeout(revealTimer.current);
    setPressedReveal((previous) => !previous);
    revealTimer.current = setTimeout(() => setPressedReveal(false), TIMESTAMP_REVEAL_MS);
  };

  const labelStyle = { color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: 24 }}>
      <Pressable
        onPress={copy}
        onHoverIn={() => setOverCopy(true)}
        onHoverOut={() => setOverCopy(false)}
        accessibilityRole="button"
        accessibilityLabel={copied ? "Copied" : "Copy turn"}
        style={{ padding: SPACE.xs, marginLeft: -SPACE.xs }}
      >
        <Icon name={copied ? "Check" : "Copy"} size={ICON_SIZE} color={overCopy ? theme.colors.foreground : theme.colors.foregroundMuted} />
      </Pressable>
      {primary === "" ? null : (
        <Pressable
          onPress={reveal}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          accessibilityRole={canSwap ? "button" : undefined}
          accessibilityLabel={canSwap ? `${duration}, ended ${endedAt}` : primary}
        >
          <View>
            {/* The longer of the two, invisible, holds the width so the row does not jump on a swap. */}
            <Text style={[labelStyle, { opacity: 0 }]} aria-hidden>
              {primary.length >= endedAt.length ? primary : endedAt}
            </Text>
            <Text style={[labelStyle, { position: "absolute", top: 0, left: 0 }]}>{showEnd ? endedAt : primary}</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
