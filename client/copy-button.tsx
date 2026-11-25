/**
 * A copy icon that puts text on the clipboard and shows a check for a moment (TR-286), under a message and in a
 * code block's corner. Like the turn footer's (`turn-footer.tsx`), it copies plain text through `clipboard.ts`.
 * Ported from Paseo (cf1a5a9e, Apache-2.0): `TurnCopyButton` from `packages/app/src/components/message.tsx`.
 * `useHoverReveal` is Paseo's rule for such controls: on a desktop they show while the pointer is over their
 * message, and where there is no hover (a phone) they are always shown.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { Platform, type ViewProps } from "react-native";

import { copyText } from "./clipboard";
import { Pressable } from "./focus";
import { SPACE } from "./spacing";

const COPIED_MS = 1500;
const ICON_SIZE = 14;

/** Whether a hover-only control shows, and the pointer handlers that track it; `always` (a phone, a narrow pane) skips the hover. */
export function useHoverReveal(always: boolean): { shown: boolean; handlers: Pick<ViewProps, "onPointerEnter" | "onPointerLeave"> } {
  const [hovered, setHovered] = useState(false);
  return {
    shown: always || Platform.OS !== "web" || hovered,
    handlers: { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) },
  };
}

/** `focusable` is false while the button is hidden, so Tab does not stop on an invisible control. */
export function CopyButton({ text, label, theme, focusable = true }: { text: string; label: string; theme: PluginTheme; focusable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [over, setOver] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const copy = () => {
    if (text === "") return;
    void copyText(globalThis, text).then((done) => {
      if (!done) return;
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    });
  };
  return (
    <Pressable
      onPress={copy}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : label}
      focusable={focusable}
      style={{ padding: SPACE.xs }}
    >
      <Icon name={copied ? "Check" : "Copy"} size={ICON_SIZE} color={over ? theme.colors.foreground : theme.colors.foregroundMuted} />
    </Pressable>
  );
}
