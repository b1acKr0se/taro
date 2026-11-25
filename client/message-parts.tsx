/**
 * The small parts a chat message is drawn with (TR-286): the row of time and copy under a bubble, the fade
 * over a folded message, the "Sent by" line above a received one, and the agent's thinking as one quiet line.
 * Ported from Paseo (cf1a5a9e, Apache-2.0): the row under a bubble from `UserMessage` in `packages/app/src/components/message.tsx`,
 * the sender line from `MessageSender` and the fold from `MessagePreview` (`src/components/user-message/index.tsx`). Changed: no rewind
 * button, no link on the sender, the fade is stacked strips (the plugin has no gradient) and the theme comes as a prop.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Platform, Text, useWindowDimensions, View } from "react-native";

import { CopyButton, useHoverReveal } from "./copy-button";
import { Pressable } from "./focus";
import { Markdown } from "./markdown";
import { fadeColour } from "./shimmer";
import { FoldLinesContext, type FoldLineRef } from "./fold-lines";
import { FADE_LINES, fadeOpacities, fadeSteps, foldClipStyle, foldCut, foldHeight, foldState, mayNeedFold, rememberedFold, rememberFold, settleMeasure, type FoldBlock, type MeasuredFold } from "./received-fold";
import { SPACE } from "./spacing";
import { FONT_SIZE, lineHeightFor } from "./type-scale";
import { formatMessageTimestamp, thinkingLabel } from "./turn-time";


/** The wrapper of a message the pointer can be over, and the row under it with the time and the copy icon. */
export function MessageWithActions({ at, actions, hidden = false, text, copyLabel, always, theme, children }: { at?: string; actions: boolean; /** Laid out but not drawn: a message not sent through yet keeps the room its time and copy icon take, so it does not grow when it lands. */ hidden?: boolean; text: string; copyLabel: string; always: boolean; theme: PluginTheme; children: ReactNode }) {
  const reveal = useHoverReveal(always);
  const visible = reveal.shown && !hidden;
  const time = formatMessageTimestamp(at);
  return (
    <View style={{ alignItems: "flex-end", gap: SPACE.xs }} {...reveal.handlers}>
      {children}
      {/* Always laid out, so the chat does not jump when the pointer arrives. */}
      {actions ? <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, opacity: visible ? 1 : 0 }} pointerEvents={visible ? "auto" : "none"}>
        {time === "" ? null : <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE.small }}>{time}</Text>}
        <CopyButton text={text} label={copyLabel} theme={theme} focusable={visible} />
      </View> : null}
    </View>
  );
}

/** The last whole lines of a folded message dissolving into the bubble: the plugin has no gradient, so strips of rising opacity stack. */
export function FoldFade({ colour, height }: { colour: string; height: number }) {
  const strips = fadeOpacities(fadeSteps(height));
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height }}>
      {strips.map((opacity, index) => (
        <View key={index} style={{ flex: 1, backgroundColor: fadeColour(colour, opacity) }} />
      ))}
    </View>
  );
}

/** A view the fold can measure against another: React Native's and react-native-web's host views both have it. */
interface Measurable {
  measureLayout?: (relativeTo: unknown, onSuccess: (x: number, y: number, width: number, height: number) => void, onFail: () => void) => void;
}

/** Measures each registered block against the body, then hands the blocks over; null when nothing can be measured. */
function measureBlocks(body: unknown, registered: Map<unknown, number | null>, done: (blocks: FoldBlock[] | null) => void): void {
  const entries = Array.from(registered.entries());
  if (body === null || entries.length === 0) {
    done(null);
    return;
  }
  const blocks: FoldBlock[] = [];
  let left = entries.length;
  const settle = () => {
    left -= 1;
    if (left === 0) done(blocks.length === 0 ? null : blocks);
  };
  entries.map(([node, lineHeight]) => {
    const measurable = node as Measurable;
    if (typeof measurable.measureLayout !== "function") {
      settle();
      return;
    }
    try {
      measurable.measureLayout(
        body,
        (_x, y, _width, height) => {
          blocks.push({ top: y, height, lineHeight });
          settle();
        },
        settle,
      );
    } catch {
      settle();
    }
  });
}

/**
 * A message body that folds behind Show more when it is taller than `lines` (TR-286). It is measured as drawn, since a wide
 * pane fits twice the words a phone does: a body that fits shows no fade and no button. While a long text is not
 * measured yet it is drawn folded, so it does not grow a frame later (Paseo's `MessagePreview` paints folded first too).
 * Its blocks register through `FoldLinesContext`, so the fold ends between two lines (TR-289); a body with none (the
 * user's own message, one text from the top) ends at the fold height, which its lines meet.
 */
export function FoldableBody({ text, lines, open, onToggle, colour, buttonStyle, labelStyle, children }: { text: string; lines: number; open: boolean; onToggle: () => void; colour: string; buttonStyle: object; labelStyle: object; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const cacheKey = `${width}:${lines}:${text}`;
  const [measured, setMeasured] = useState<MeasuredFold | null>(() => rememberedFold(cacheKey));
  const lineHeight = bodyLineHeight();
  const fold = foldHeight(lineHeight, lines);
  const candidate = mayNeedFold(text, lines);
  // Until measured the body is only clipped: the fade and the button wait for the measure, so a message that fits never flashes them (the chat flickered as rows remounted).
  const { overflowing, folded } = foldState(candidate, measured?.natural ?? null, open, lineHeight, lines);
  const clipAt = folded ? (overflowing && measured !== null && measured.cut !== null ? measured.cut : fold) : null;
  const body = useRef<View>(null);
  const registered = useRef(new Map<unknown, number | null>());
  const refs = useRef(new Map<string, (node: unknown) => (() => void) | undefined>());
  const lineRef = useCallback<FoldLineRef>((blockLineHeight) => {
    const key = String(blockLineHeight);
    const known = refs.current.get(key);
    if (known !== undefined) return known;
    const ref = (node: unknown) => {
      if (node === null) return undefined;
      registered.current.set(node, blockLineHeight);
      return () => {
        registered.current.delete(node);
      };
    };
    refs.current.set(key, ref);
    return ref;
  }, []);
  return (
    <>
      <View style={clipAt === null ? undefined : foldClipStyle(clipAt, Platform.OS === "web")}>
        <View
          ref={body}
          style={{ flexShrink: 0 }}
          onLayout={
            candidate
              ? (event) => {
                  const natural = settleMeasure(event.nativeEvent.layout.height, clipAt, fold);
                  measureBlocks(body.current, registered.current, (blocks) => {
                    const next = { natural, cut: blocks === null ? null : foldCut(blocks, fold) };
                    rememberFold(cacheKey, next);
                    setMeasured((previous) => (previous !== null && previous.natural === next.natural && previous.cut === next.cut ? previous : next));
                  });
                }
              : undefined
          }
        >
          <FoldLinesContext.Provider value={candidate ? lineRef : null}>{children}</FoldLinesContext.Provider>
        </View>
        {clipAt !== null && overflowing ? <FoldFade colour={colour} height={Math.min(lineHeight * FADE_LINES, clipAt)} /> : null}
      </View>
      {overflowing ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={buttonStyle}>
          <Text style={labelStyle}>{open ? "Show less" : "Show more"}</Text>
        </Pressable>
      ) : null}
    </>
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
