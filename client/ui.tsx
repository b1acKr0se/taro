/**
 * The few pieces every Taro screen draws with. The host kit has settings
 * rows and a modal but no button, so these are built from `Pressable`, with
 * every colour taken from the theme.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Platform, Pressable, Text, View } from "react-native";
import { BUTTON, SEGMENTED } from "./control-size";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

/** A fixed-width font on every platform; iOS has no font named "monospace". */
export const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

export type Tone = "default" | "accent" | "danger";


export function IconButton({
  icon,
  label,
  theme,
  onPress,
  tone = "default",
  disabled = false,
  showLabel = false,
  accessibilityLabel,
  grow = false,
  state,
}: {
  /** Null draws the label alone (a narrow row of labelled buttons); busy and done still show. */
  icon: string | null;
  label: string;
  theme: PluginTheme;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  /** A call it sent (TR-058): "busy" spins in place of the icon and takes no press; "done" shows a check for a moment. */
  state?: "busy" | "done" | undefined;
  /** Draws the label beside the icon; otherwise it is only the accessibility label. */
  showLabel?: boolean;
  /** Read out in place of a shown label too short to say what the button does ("Board" for Back to Board). */
  accessibilityLabel?: string;
  /** Takes a share of its row's spare width, its content centred: one of a pair that wraps to equal full-width rows. */
  grow?: boolean;
}) {
  const colors = theme.colors;
  const color =
    tone === "accent" ? colors.accentForeground : tone === "danger" ? colors.statusDanger : colors.foreground;
  const busy = state === "busy";
  // The pressed button stays at full strength while it spins; only the buttons waiting on it fade.
  const faded = disabled && !busy;
  const styles = useMemo(
    () => ({
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        flexGrow: grow ? 1 : 0,
        // At least: a long label wraps onto more lines in a narrow card.
        minHeight: BUTTON.height,
        gap: BUTTON.gap,
        paddingHorizontal: showLabel ? BUTTON.paddingHorizontal : BUTTON.iconOnlyPaddingHorizontal,
        paddingVertical: BUTTON.paddingVertical,
        borderRadius: BUTTON.borderRadius,
        borderWidth: BUTTON.borderWidth,
        borderColor: tone === "accent" ? colors.accent : colors.border,
        backgroundColor: tone === "accent" ? colors.accent : colors.surface1,
        opacity: faded ? 0.5 : 1,
        // A long label — a card action the agent named — wraps inside a narrow card instead of overflowing it.
        maxWidth: "100%" as const,
      },
      label: { color, fontSize: BUTTON.fontSize, lineHeight: BUTTON.lineHeight, fontWeight: "500" as const, flexShrink: 1 },
    }),
    [colors, tone, faded, showLabel, grow, color],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={styles.button}
    >
      {busy ? (
        <Spinner size={BUTTON.iconSize} color={color} />
      ) : state === "done" ? (
        <Icon name="Check" size={BUTTON.iconSize} color={tone === "default" ? colors.statusSuccess : color} />
      ) : icon === null ? null : (
        <Icon name={icon} size={BUTTON.iconSize} color={color} />
      )}
      {showLabel ? <Text style={styles.label}>{label}</Text> : null}
    </Pressable>
  );
}

/** The widest the acceptance pair grows, so on a wide card it stays a pair of buttons rather than a bar. */
const ACCEPTANCE_PAIR_MAX_WIDTH = 320;

/**
 * Accept and Request changes as one matched pair (TR-048), wherever a delivery waits for the user: the
 * same button twice, Accept filled as the primary and Request changes outlined as the secondary. Side
 * by side, sharing the row; where the card is too narrow for both, each takes a full row of its own.
 * Accept is left out while the evidence is incomplete.
 */
export function AcceptancePair({
  theme,
  busy,
  acceptState,
  requestLabel,
  onAccept,
  onRequestChanges,
}: {
  theme: PluginTheme;
  busy: boolean;
  acceptState?: "busy" | "done" | undefined;
  /** "Request changes…" where the field opens here; "Request changes" where it opens the ticket. */
  requestLabel: string;
  onAccept: (() => void) | null;
  onRequestChanges: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, width: "100%", maxWidth: ACCEPTANCE_PAIR_MAX_WIDTH }}>
      {onAccept === null ? null : <IconButton icon="Check" label="Accept" showLabel grow tone="accent" theme={theme} disabled={busy} state={acceptState} onPress={onAccept} />}
      <IconButton icon="MessageSquare" label={requestLabel} showLabel grow theme={theme} disabled={busy} onPress={onRequestChanges} />
    </View>
  );
}

/**
 * A two-or-more-way switch, drawn to sit in a row of `IconButton`s: the same
 * height and radius, centred on the row's line like them (TR-077).
 */
export function Segmented<Value extends string>({
  theme,
  value,
  options,
  onChange,
  iconsOnly = false,
}: {
  theme: PluginTheme;
  value: Value;
  /** `icon` is a Lucide name drawn before the label. */
  options: ReadonlyArray<{ value: Value; label: string; icon?: string }>;
  onChange: (value: Value) => void;
  /** Icons only, the labels kept for screen readers: a phone's header has no room for words (TR-031). */
  iconsOnly?: boolean;
}) {
  const colors = theme.colors;
  const styles = useMemo(
    () => ({
      // A quiet track with the chosen segment raised on it, rather than a block of accent colour.
      // Sized to its segments in a column as in a row, yet centred in a row like the buttons beside it (pinned to its top it sat higher, TR-077).
      holder: { flexDirection: "row" as const },
      frame: {
        flexDirection: "row" as const,
        height: BUTTON.height,
        padding: SEGMENTED.padding,
        gap: SEGMENTED.gap,
        borderRadius: BUTTON.borderRadius,
        backgroundColor: colors.surface1,
      },
      segment: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: BUTTON.gap,
        paddingHorizontal: BUTTON.paddingHorizontal,
        borderRadius: SEGMENTED.segmentRadius,
        // The track's colour until selected, so choosing a segment does not widen it by its border.
        borderWidth: BUTTON.borderWidth,
        borderColor: colors.surface1,
      },
      selected: { backgroundColor: colors.surface2, borderColor: colors.border },
      label: { color: colors.foregroundMuted, fontSize: BUTTON.fontSize, lineHeight: BUTTON.lineHeight, fontWeight: "500" as const },
      labelSelected: { color: colors.foreground, fontWeight: "600" as const },
    }),
    [colors],
  );
  return (
    <View style={styles.holder}>
      <View style={styles.frame} accessibilityRole="tablist">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="tab"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              style={[styles.segment, selected ? styles.selected : null, iconsOnly ? { paddingHorizontal: BUTTON.iconOnlyPaddingHorizontal } : null]}
              onPress={() => onChange(option.value)}
            >
              {option.icon === undefined ? null : <Icon name={option.icon} size={BUTTON.iconSize} color={selected ? colors.foreground : colors.foregroundMuted} />}
              {iconsOnly && option.icon !== undefined ? null : <Text style={[styles.label, selected ? styles.labelSelected : null]}>{option.label}</Text>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The round button over a transcript's foot that goes back to its end, shown
 * while the reader is scrolled away from it — as in Paseo's own agent view.
 * Its parent must be the transcript's frame; it positions itself in it.
 */
export function JumpToEnd({ theme, onPress }: { theme: PluginTheme; onPress: () => void }) {
  const colors = theme.colors;
  const styles = useMemo(
    () => ({
      frame: { position: "absolute" as const, left: 0, right: 0, bottom: 12, alignItems: "center" as const },
      button: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
    }),
    [colors],
  );
  return (
    <View style={styles.frame} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel="Scroll to the latest" onPress={onPress} style={styles.button}>
        <Icon name="ChevronDown" size={20} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

/**
 * A thin bar across the top of a pane while it re-reads what it already shows (TR-018). It keeps
 * its height when idle, so the content under it does not jump as it comes and goes.
 */
export function LoadingBar({ theme, active }: { theme: PluginTheme; active: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    progress.setValue(0);
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [active, progress]);
  const left = progress.interpolate({ inputRange: [0, 1], outputRange: ["-35%", "100%"] });
  return (
    <View
      style={{ height: 2, overflow: "hidden" }}
      accessibilityRole="progressbar"
      accessibilityLabel={active ? "Loading" : undefined}
      accessibilityElementsHidden={!active}
    >
      {active ? <Animated.View style={{ position: "absolute", top: 0, bottom: 0, width: "35%", left, backgroundColor: theme.colors.accent }} /> : null}
    </View>
  );
}

/** The box of `ActivityIndicator`'s "small" size, which the spinner is scaled down from. */
const SMALL_SPINNER = 20;

/**
 * Something running, drawn the size of the icon it stands in for. Lucide's
 * Loader is a spinner drawn standing still, and at a glance a still spinner
 * reads as broken; React Native's own `ActivityIndicator` turns on every
 * platform. It has only two sizes, so the small one is scaled into a box of
 * the icon's size, keeping the row it sits in the same height.
 */
export function Spinner({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="small" color={color} style={{ transform: [{ scale: size / SMALL_SPINNER }] }} />
    </View>
  );
}

/** A full-width notice under the header. */
export interface BannerAction {
  label: string;
  icon: string;
  onPress: () => void;
  disabled?: boolean;
}

export function Banner({
  theme,
  tone,
  text,
  action,
  actions,
}: {
  theme: PluginTheme;
  tone: "warning" | "danger" | "info";
  text: string;
  action?: BannerAction;
  /** More than one action, in order; drawn after `action`. */
  actions?: readonly BannerAction[];
}) {
  const colors = theme.colors;
  const color =
    tone === "danger" ? colors.statusDanger : tone === "warning" ? colors.statusWarning : colors.foregroundMuted;
  const styles = useMemo(
    () => ({
      banner: {
        flexDirection: "row" as const,
        // On a phone the buttons go to a line of their own rather than squeezing the text to a column.
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 10,
        borderWidth: 1,
        borderColor: color,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: colors.surface1,
      },
      text: { flex: 1, minWidth: 200, color: colors.foreground, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
    }),
    [colors, color],
  );
  return (
    <View style={styles.banner}>
      <Icon name={tone === "info" ? "Info" : "AlertTriangle"} size={14} color={color} />
      <Text style={styles.text}>{text}</Text>
      {[...(action === undefined ? [] : [action]), ...(actions ?? [])].map((each) => (
        <IconButton
          key={each.label}
          icon={each.icon}
          label={each.label}
          theme={theme}
          tone="accent"
          showLabel
          disabled={each.disabled === true}
          onPress={each.onPress}
        />
      ))}
    </View>
  );
}

/** A small rounded label, coloured by what it describes. */
export function Chip({ theme, text, color, icon }: { theme: PluginTheme; text: string; color: string; /** A Lucide name drawn in `color` instead of the dot. */ icon?: string }) {
  const styles = useMemo(
    () => ({
      chip: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color },
      text: { color: theme.colors.foreground, fontSize: FONT_SIZE.caption },
    }),
    [theme, color],
  );
  return (
    <View style={styles.chip}>
      {icon === undefined ? <View style={styles.dot} /> : <Icon name={icon} size={12} color={color} />}
      <Text style={styles.text} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export { errorText } from "./format";
