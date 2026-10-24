/**
 * Taro's one reply box (TR-083): the chat composer's rounded box, its font, padding, placeholder colour
 * and growing height. The chats add a row of controls under the text, the round send button in its
 * bottom-right corner; the Plan, the acceptance card, decision cards and the agent question form draw
 * the box alone, with their buttons under it, so every place the user types a reply looks alike.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, useWindowDimensions, View, type NativeSyntheticEvent, type TextInput as NativeTextInput, type TextInputSelectionChangeEventData } from "react-native";

import { COMPOSER_CONTROL_SIZE, COMPOSER_FONT_SIZE, COMPOSER_WEB_LINE_HEIGHT, composerMaxHeight, composerMetrics, sendsOnEnter } from "./composer-height";
import { useComposerHeight } from "./composer-input-height";
import { Pressable, TextInput } from "./focus";
import { primaryAction } from "./composer-notice";
import { enterKeyAction, isStopKey, type WebKeyPressEvent } from "./keys";
import { createNativeFieldSync } from "./native-field-sync";
import { SPACE } from "./spacing";
import { Spinner } from "./ui";

export interface ReplyBoxProps {
  theme: PluginTheme;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /** Sends what the box holds. Without it the box has no send button (a form's field, answered by the form's own button). */
  onSend?: (() => void) | undefined;
  /** Whether there is something to send; the send button is dimmed and Enter does nothing otherwise. */
  canSend?: boolean | undefined;
  /** The send button's accessibility label: "Send", "Send changes", "Submit". */
  sendLabel?: string | undefined;
  /** A call the send made (`useActions`): "busy" spins in the button, "done" shows a check for a moment. */
  sendState?: "busy" | "done" | undefined;
  /**
   * Given while the agent works (TR-181): with nothing to send, the send button becomes Paseo's red stop
   * button, which calls `onStop`, and Escape in the box calls it whatever the box holds. `busy` while it stops.
   */
  stop?: { onStop: () => void; busy: boolean } | undefined;
  /** A phone-sized layout, where Enter makes a new line; by default, a window narrower than Paseo's `md`. */
  compact?: boolean | undefined;
  /** The fill behind the text: the chat's surface1 on a plain pane, surface0 inside a card that is surface1. */
  background?: string | undefined;
  fieldRef?: RefObject<NativeTextInput | null> | undefined;
  onFocus?: (() => void) | undefined;
  editable?: boolean | undefined;
  /** Greyed and not editable, keeping what it holds (TR-083): a card's box until Other is picked. */
  greyed?: boolean | undefined;
  /** Pressing the greyed box: the card picks Other, and the box takes the focus once it opens. */
  onPressGreyed?: (() => void) | undefined;
  autoFocus?: boolean | undefined;
  accessibilityLabel?: string | undefined;
  /** Says in the placeholder that Enter sends, where it does (the chats). */
  enterHint?: boolean | undefined;
  /** Inside the box, above the text (the chat's attachments). */
  above?: ReactNode | undefined;
  /** At the left of the controls row (the chat's +). */
  leading?: ReactNode | undefined;
  /** Beside the send button, at its left (the chat's context ring). */
  trailing?: ReactNode | undefined;
  /** Hears where the cursor is after each move or edit, null while text is selected (the chat's pick list, TR-232). */
  onCursor?: ((cursor: number | null) => void) | undefined;
  /** Sees each key on the web before the box's Enter and Escape; true takes the key, which then does nothing else. */
  interceptKey?: ((event: WebKeyPressEvent["nativeEvent"]) => boolean) | undefined;
  /**
   * Once the box holds `text`, set from outside, the cursor goes to `at` and the box takes the focus: a pick
   * from the pick list. A new object each time; on the phone the field it remounts with takes it once.
   */
  placeCursor?: { text: string; at: number } | undefined;
}

export function ReplyBox({
  theme,
  value,
  onChangeText,
  placeholder,
  onSend,
  canSend = true,
  sendLabel = "Send",
  sendState,
  stop,
  compact,
  background,
  fieldRef,
  onFocus,
  editable = true,
  greyed = false,
  onPressGreyed,
  autoFocus,
  accessibilityLabel,
  enterHint = false,
  above = null,
  leading = null,
  trailing = null,
  onCursor,
  interceptKey,
  placeCursor,
}: ReplyBoxProps) {
  const ownField = useRef<NativeTextInput>(null);
  const field = fieldRef ?? ownField;
  const focusWhenOpen = useRef(false);
  useEffect(() => {
    if (greyed || !focusWhenOpen.current) return;
    focusWhenOpen.current = false;
    field.current?.focus();
  }, [greyed, field]);
  const web = Platform.OS === "web";
  const nativeText = useNativeText(!web, value, onChangeText, field, placeCursor);
  const placedOnWeb = useRef<object | null>(null);
  useLayoutEffect(() => {
    if (!web || placeCursor === undefined || placedOnWeb.current === placeCursor || value !== placeCursor.text) return;
    placedOnWeb.current = placeCursor;
    // A press on the list took the focus; the DOM's textarea already holds the new text here.
    field.current?.focus();
    (field.current as unknown as { setSelectionRange?: (start: number, end: number) => void } | null)?.setSelectionRange?.(placeCursor.at, placeCursor.at);
  }, [web, placeCursor, value, field]);
  const windowSize = useWindowDimensions();
  const metrics = composerMetrics(web, windowSize.width);
  const height = useComposerHeight({ text: value, field, minHeight: metrics.minHeight, maxHeight: composerMaxHeight(windowSize.height) });
  const submitOnEnter = onSend !== undefined && sendsOnEnter({ web, compact, windowWidth: windowSize.width });
  const busy = sendState === "busy";
  const sendable = canSend && editable && !greyed && !busy;
  const stops = onSend !== undefined && primaryAction({ sendable: canSend || busy, stoppable: stop !== undefined && editable && !greyed }) === "stop";
  // Lucide draws its square 18 units wide in a 24-unit icon.
  const stopSquare = Math.round((metrics.iconSize * 18) / 24);
  const stopKey = web && stop !== undefined && editable && !greyed;
  const { colors } = theme;
  const hasControls = onSend !== undefined || leading !== null || trailing !== null;
  const styles = useMemo(
    () => ({
      // Paseo's composer box (TR-039); its border stays plain while typing, as Paseo's does.
      box: {
        flexShrink: 1,
        flexDirection: "column" as const,
        gap: SPACE.md,
        backgroundColor: background ?? colors.surface1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        paddingTop: metrics.paddingTop,
        paddingBottom: metrics.paddingBottom,
        paddingHorizontal: metrics.paddingHorizontal,
        opacity: greyed ? 0.5 : 1,
      },
      input: {
        flexShrink: 1,
        width: "100%" as const,
        color: colors.foreground,
        fontSize: COMPOSER_FONT_SIZE,
        textAlignVertical: "top" as const,
        // No line height on a phone, as in Paseo: React Native draws one as a span over the text, and
        // an empty last line takes the font's own, so the field jumped when a new line began.
        ...(web ? { lineHeight: COMPOSER_WEB_LINE_HEIGHT } : null),
      },
      // The row reaches 6 px into the box's padding, so the round buttons sit in its corners.
      controls: {
        flexShrink: 0,
        flexDirection: "row" as const,
        alignItems: "flex-end" as const,
        justifyContent: "space-between" as const,
        marginHorizontal: -6,
      },
      controlsEnd: { flexShrink: 0, flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.xs, marginLeft: "auto" as const },
      // A filled circle, the size of the + and the ring's slot.
      send: {
        width: COMPOSER_CONTROL_SIZE,
        height: COMPOSER_CONTROL_SIZE,
        borderRadius: COMPOSER_CONTROL_SIZE / 2,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: colors.accent,
        marginLeft: SPACE.xs,
      },
      // Paseo's stop button: the send button's circle in red, with a filled square.
      stop: {
        width: COMPOSER_CONTROL_SIZE,
        height: COMPOSER_CONTROL_SIZE,
        borderRadius: COMPOSER_CONTROL_SIZE / 2,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: colors.statusDanger,
        marginLeft: SPACE.xs,
      },
    }),
    [colors, background, web, greyed, metrics.paddingTop, metrics.paddingBottom, metrics.paddingHorizontal],
  );

  const box = (
    <View style={styles.box} pointerEvents={greyed && onPressGreyed !== undefined ? "none" : "auto"}>
      {above}
      <TextInput
        ref={field}
        key={web ? undefined : nativeText.revision}
        {...(web ? { value, onChangeText } : { defaultValue: nativeText.text, onChangeText: nativeText.onChangeText })}
        onFocus={onFocus}
        placeholder={submitOnEnter && enterHint ? `${placeholder} (Enter sends, Shift+Enter for a new line)` : placeholder}
        placeholderTextColor={colors.foregroundMuted}
        accessibilityLabel={accessibilityLabel}
        editable={editable && !greyed}
        autoFocus={nativeText.revision === 0 ? autoFocus : nativeText.refocus}
        multiline
        scrollEnabled={height.scrollEnabled}
        onSelectionChange={
          onCursor === undefined
            ? undefined
            : (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
                const { start, end } = event.nativeEvent.selection;
                onCursor(start === end ? end : null);
              }
        }
        onKeyPress={
          submitOnEnter || stopKey || interceptKey !== undefined
            ? (event: WebKeyPressEvent) => {
                if (interceptKey?.(event.nativeEvent) === true) {
                  event.preventDefault();
                  return;
                }
                if (stopKey && isStopKey(event.nativeEvent)) {
                  if (!stop.busy) stop.onStop();
                  return;
                }
                if (!submitOnEnter) return;
                const action = enterKeyAction(event.nativeEvent, sendable);
                if (action === null) return;
                event.preventDefault();
                if (action === "send") onSend?.();
              }
            : undefined
        }
        style={[styles.input, height.style]}
      />
      {hasControls ? (
        <View style={styles.controls}>
          {leading}
          <View style={styles.controlsEnd}>
            {trailing}
            {onSend === undefined ? null : stops && stop !== undefined ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={stop.busy ? "Stopping agent" : "Stop agent"}
                accessibilityState={{ disabled: stop.busy, busy: stop.busy }}
                disabled={stop.busy}
                style={styles.stop}
                onPress={stop.onStop}
              >
                {stop.busy ? (
                  <Spinner size={metrics.iconSize} color={colors.accentForeground} />
                ) : (
                  // Lucide's filled Square, as Paseo draws it: the host's Icon has no fill.
                  <View style={{ width: stopSquare, height: stopSquare, borderRadius: 2, backgroundColor: colors.accentForeground }} />
                )}
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={sendLabel}
                accessibilityState={{ disabled: !sendable, busy }}
                disabled={!sendable}
                // The pressed button stays at full strength while it spins.
                style={[styles.send, { opacity: sendable || busy ? 1 : 0.5 }]}
                onPress={onSend}
              >
                {busy ? (
                  <Spinner size={metrics.iconSize} color={colors.accentForeground} />
                ) : (
                  <Icon name={sendState === "done" ? "Check" : "ArrowUp"} size={metrics.iconSize} color={colors.accentForeground} />
                )}
              </Pressable>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
  // Always the same wrapper, pressable only while greyed: a different parent would remount the field.
  const opens = greyed && onPressGreyed !== undefined;
  return (
    <Pressable
      accessible={opens}
      {...(opens ? { accessibilityRole: "button" as const, accessibilityLabel: "Write your own answer" } : null)}
      disabled={!opens}
      onPress={() => {
        focusWhenOpen.current = true;
        onPressGreyed?.();
      }}
    >
      {box}
    </Pressable>
  );
}

/**
 * The phone's field keeps its own text (TR-125), as Paseo's composer does: JavaScript never writes it
 * back while the reader types, so a pane slow to render long text cannot race the keyboard, the race
 * that crashed the app. A draft set from outside (cleared on send, put back, another agent's) replaces
 * the field, which also resets its grown height, keeping the focus it had.
 */
function useNativeText(
  enabled: boolean,
  value: string,
  onChangeText: (text: string) => void,
  field: RefObject<NativeTextInput | null>,
  placeCursor: { text: string; at: number } | undefined,
) {
  const [sync] = useState(() => createNativeFieldSync(value));
  const [shown, setShown] = useState({ revision: 0, text: value, refocus: false });
  const placed = useRef<object | null>(null);
  // Where the field remounted for a pick puts its cursor, once: a `selection` prop would hold it there as the reader types.
  const cursorOnRemount = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const request = placeCursor !== undefined && placed.current !== placeCursor && placeCursor.text === value ? placeCursor : null;
    if (request !== null) placed.current = request;
    if (!sync.outside(value)) {
      // The text is already the field's own: only the cursor moves, which writes no text back.
      if (request !== null) setFieldCursor(field.current, request.at);
      return;
    }
    const refocus = field.current?.isFocused() ?? false;
    cursorOnRemount.current = request?.at ?? null;
    setShown((current) => ({ revision: current.revision + 1, text: value, refocus: refocus || request !== null }));
  }, [enabled, value, sync, field, placeCursor]);
  useEffect(() => {
    if (cursorOnRemount.current === null) return;
    setFieldCursor(field.current, cursorOnRemount.current);
    cursorOnRemount.current = null;
  }, [shown.revision, field]);
  return {
    ...shown,
    onChangeText: (text: string) => {
      sync.typed(text);
      // Android sizes the field again only when its text prop changes, and a held delete (batched by the
      // keyboard) left an emptied box several lines tall: emptying it changes that prop, once, to "".
      if (text === "") setShown((current) => (current.text === "" ? current : { ...current, text: "" }));
      onChangeText(text);
    },
  };
}

/** React Native's `setSelection` (text left as it is), looked up as an older host may lack it. */
function setFieldCursor(field: NativeTextInput | null, at: number): void {
  (field as unknown as { setSelection?: (start: number, end: number) => void } | null)?.setSelection?.(at, at);
}
