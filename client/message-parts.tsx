/**
 * The small parts a chat message is drawn with (TR-286): the row of time and copy under a bubble, the fade
 * over a folded message, the "Sent by" line above a received one, and the agent's thinking as one quiet line.
 * Ported from Paseo (cf1a5a9e, Apache-2.0): the row under a bubble from `UserMessage` in `packages/app/src/components/message.tsx`,
 * the sender line from `MessageSender` and the fold from `MessagePreview` (`src/components/user-message/index.tsx`). Changed: no rewind
 * button, no link on the sender, the fade is stacked strips (the plugin has no gradient) and the theme comes as a prop.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { CopyButton, useHoverReveal } from "./copy-button";
import { Pressable } from "./focus";
import { Markdown } from "./markdown";
import { fadeColour } from "./shimmer";
import { fadeOpacities } from "./received-fold";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { formatMessageTimestamp, thinkingLabel } from "./turn-time";

const FADE_HEIGHT_LINES = 2;

/** The wrapper of a message the pointer can be over, and the row under it with the time and the copy icon. */
export function MessageWithActions({ at, actions, text, copyLabel, always, theme, children }: { at?: string; actions: boolean; text: string; copyLabel: string; always: boolean; theme: PluginTheme; children: ReactNode }) {
  const reveal = useHoverReveal(always);
  const time = formatMessageTimestamp(at);
  return (
    <View style={{ alignItems: "flex-end", gap: SPACE.xs }} {...reveal.handlers}>
      {children}
      {/* Always laid out, so the chat does not jump when the pointer arrives. */}
      {actions ? <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, opacity: reveal.shown ? 1 : 0 }} pointerEvents={reveal.shown ? "auto" : "none"}>
        {time === "" ? null : <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small }}>{time}</Text>}
        <CopyButton text={text} label={copyLabel} theme={theme} />
      </View> : null}
    </View>
  );
}

/** The last lines of a folded message dissolving into the bubble: the plugin has no gradient, so strips of rising opacity stack. */
export function FoldFade({ colour, lineHeight }: { colour: string; lineHeight: number }) {
  const strips = fadeOpacities();
  const height = lineHeight * FADE_HEIGHT_LINES;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height }}>
      {strips.map((opacity, index) => (
        <View key={index} style={{ flex: 1, backgroundColor: fadeColour(colour, opacity) }} />
      ))}
    </View>
  );
}

/** A folded body: its first lines clipped to `height`, with the fade over their end. */
export function FoldedBody({ height, colour, lineHeight, children }: { height: number; colour: string; lineHeight: number; children: ReactNode }) {
  return (
    <View style={{ maxHeight: height, overflow: "hidden" }}>
      {children}
      <FoldFade colour={colour} lineHeight={lineHeight} />
    </View>
  );
}

/** "Sent by Reviewer" above a message another agent sent, as Paseo draws it, drawn as plain text. */
export function SentByLine({ sender, theme }: { sender: string; theme: PluginTheme }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, alignSelf: "flex-start", maxWidth: "100%" }} accessibilityLabel={`Message from ${sender}`}>
      <Icon name="Bot" size={14} color={theme.colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small, flexShrink: 1 }}>
        {`Sent by ${sender}`}
      </Text>
    </View>
  );
}

/** The agent's thinking: one muted line, closed until pressed; open, its text sits muted behind a thin left rail with no box. */
export function ThinkingLine({ text, durationMs, open, onToggle, theme, onOpenLink }: { text: string; durationMs: number | null; open: boolean; onToggle: () => void; theme: PluginTheme; onOpenLink: (url: string) => void }) {
  const label = thinkingLabel(durationMs);
  const muted = theme.colors.foregroundMuted;
  return (
    <View style={{ gap: SPACE.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}, ${open ? "fold" : "show"}`}
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs + 2, alignSelf: "flex-start", paddingVertical: SPACE.xs }}
      >
        <Icon name="Brain" size={14} color={muted} />
        <Text style={{ color: muted, fontSize: FONT_SIZE.small }}>{label}</Text>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={muted} />
      </Pressable>
      {open ? (
        <View style={{ borderLeftWidth: 2, borderLeftColor: theme.colors.border, paddingLeft: SPACE.md, marginLeft: SPACE.xs }}>
          <Markdown source={text} theme={theme} fontSize={FONT_SIZE.small} onOpenLink={onOpenLink} />
        </View>
      ) : null}
    </View>
  );
}

/** The line height a message's text is drawn at, for the fade and the fold. */
export function bodyLineHeight(): number {
  return lineHeightFor(FONT_SIZE.body);
}
