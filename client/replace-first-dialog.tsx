/**
 * Asked while Replace manager is offered (TR-161): a press on Catch up, Compact, a suggestion or Send
 * would make the idle manager reread its whole context uncached, so it first recommends replacing,
 * with a way to go ahead anyway. Closing it does neither and keeps the composer's words.
 *
 * A centred dialog on every screen, drawn in the screen's layer (`screen-layer.tsx`); Android's back
 * and the web's Escape close it as they would a modal.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef } from "react";
import { Keyboard, Platform, Text, View } from "react-native";

import { REPLACE_MANAGER_LABEL, replaceFirstDialog, type ReplaceFirstAction } from "../shared/manager-actions";
import { Pressable } from "./focus";
import { useScreenLayer } from "./screen-layer";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { IconButton } from "./ui";
import { useBackStep } from "./use-back";

/** Wide enough for the explanation in four or five lines; a phone gets its width less the margins. */
const DIALOG_MAX_WIDTH = 480;

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
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      // The attachment sheet's wash behind it (`composer-attachments.tsx`): the theme has no scrim colour.
      backdrop: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, padding: SPACE.lg, backgroundColor: withAlpha(colors.surface0, 0.6) },
      dialog: {
        width: "100%" as const,
        maxWidth: DIALOG_MAX_WIDTH,
        backgroundColor: colors.surface1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: SPACE.lg,
        gap: SPACE.md,
      },
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.sm },
      title: { flex: 1, color: colors.foreground, fontSize: FONT_SIZE.content, lineHeight: lineHeightFor(FONT_SIZE.content), fontWeight: "600" as const },
      body: { color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) },
      buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: SPACE.sm },
    }),
    [colors],
  );
  const open = asked !== null;
  useBackStep(open, onClose);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  // A phone's keyboard, up from typing the message, would hide the dialog's lower half.
  useEffect(() => {
    if (open) Keyboard.dismiss();
  }, [open]);
  useEffect(() => {
    if (!open || Platform.OS !== "web") return undefined;
    const page = (globalThis as { document?: KeyDocument }).document;
    function onKey(event: { key: string }): void {
      if (event.key === "Escape") latestClose.current();
    }
    page?.addEventListener("keydown", onKey);
    return () => page?.removeEventListener("keydown", onKey);
  }, [open]);
  const words = asked === null ? null : replaceFirstDialog(asked, tokens);
  const dialog =
    words === null ? null : (
      <Pressable accessibilityLabel="Dismiss" style={styles.backdrop} onPress={onClose}>
        {/* A press on the dialog itself must not reach the backdrop behind it. */}
        <Pressable onPress={() => undefined} style={styles.dialog}>
          <View style={styles.header}>
            <Text style={styles.title}>{words.title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={{ padding: SPACE.xxs }}>
              <Icon name="X" size={16} color={colors.foregroundMuted} />
            </Pressable>
          </View>
          <Text style={styles.body}>{words.body}</Text>
          {/* The recommendation first and filled, as Accept is on a delivery card; each takes half the row and wraps to full width when narrow. */}
          <View style={styles.buttons}>
            <IconButton icon="RefreshCw" label={REPLACE_MANAGER_LABEL} showLabel grow tone="accent" theme={theme} onPress={onReplace} />
            <IconButton icon={null} label={words.goAhead} showLabel grow theme={theme} onPress={onGoAhead} />
          </View>
        </Pressable>
      </Pressable>
    );
  useScreenLayer(dialog);
  return null;
}

/** The web page's keyboard events, as far as Escape needs them. */
interface KeyDocument {
  addEventListener(type: "keydown", listener: (event: { key: string }) => void): void;
  removeEventListener(type: "keydown", listener: (event: { key: string }) => void): void;
}
