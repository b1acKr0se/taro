/**
 * Taro's one reply box (TR-083): the chat composer's rounded box, its font, padding, placeholder colour
 * and growing height. The chats add a row of controls under the text, the round send button in its
 * bottom-right corner; the Plan, the acceptance card, decision cards and the agent question form draw
 * the box alone, with their buttons under it, so every place the user types a reply looks alike.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { Platform, useWindowDimensions, View, type TextInput as NativeTextInput } from "react-native";

import { COMPOSER_CONTROL_SIZE, COMPOSER_FONT_SIZE, COMPOSER_WEB_LINE_HEIGHT, composerMaxHeight, composerMetrics, sendsOnEnter } from "./composer-height";
import { useComposerHeight } from "./composer-input-height";
import { Pressable, TextInput } from "./focus";
import { enterKeyAction, type WebKeyPressEvent } from "./keys";
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
  const windowSize = useWindowDimensions();
  const metrics = composerMetrics(web, windowSize.width);
  const height = useComposerHeight({ text: value, field, minHeight: metrics.minHeight, maxHeight: composerMaxHeight(windowSize.height) });
  const submitOnEnter = onSend !== undefined && sendsOnEnter({ web, compact, windowWidth: windowSize.width });
  const busy = sendState === "busy";
  const sendable = canSend && editable && !greyed && !busy;
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
    }),
    [colors, background, web, greyed, metrics.paddingTop, metrics.paddingBottom, metrics.paddingHorizontal],
  );

  const box = (
    <View style={styles.box} pointerEvents={greyed && onPressGreyed !== undefined ? "none" : "auto"}>
      {above}
      <TextInput
        ref={field}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        placeholder={submitOnEnter && enterHint ? `${placeholder} (Enter sends, Shift+Enter for a new line)` : placeholder}
        placeholderTextColor={colors.foregroundMuted}
        accessibilityLabel={accessibilityLabel}
        editable={editable && !greyed}
        autoFocus={autoFocus}
        multiline
        scrollEnabled={height.scrollEnabled}
        onKeyPress={
          submitOnEnter
            ? (event: WebKeyPressEvent) => {
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
            {onSend === undefined ? null : (
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
