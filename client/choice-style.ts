/**
 * How the settings page marks a chosen option (TR-121). A chosen card painted in accent read as too
 * much on a page of them, so a setting's options share one plain box split by dividers and only the
 * filled radio says which is on; a chosen model chip stays neutral too.
 */
import { controlColors } from "./control-colors";
import { SPACE } from "./spacing";

interface ThemeColors {
  readonly surface0: string;
  readonly surface1: string;
  readonly surface2: string;
  readonly foreground: string;
  readonly foregroundMuted: string;
  readonly accent: string;
  readonly border: string;
}

/** The one box holding a setting's options, drawn like a text field (TR-083). */
export function choiceListStyle(colors: ThemeColors) {
  return { borderWidth: 1, borderRadius: 10, borderColor: colors.border, backgroundColor: colors.surface0, overflow: "hidden" as const };
}

/** One option in the box: the same whether chosen or not, with a divider above all but the first. */
export function choiceRowStyle(colors: ThemeColors, first: boolean) {
  return {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: SPACE.md,
    padding: SPACE.md,
    borderTopWidth: first ? 0 : 1,
    borderTopColor: colors.border,
  };
}

/** An option that cannot be picked fades its radio and text, never the divider shared with its neighbours. */
export function choiceContentOpacity(faded: boolean): number {
  return faded ? 0.6 : 1;
}

/** The radio ring; the accent shows only on the chosen one's ring and dot. */
export function radioStyle(colors: ThemeColors, selected: boolean) {
  return {
    marginTop: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: selected ? colors.accent : colors.foregroundMuted,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
}

/** A chosen subagent model: an outlined control like the page's other chips and buttons (TR-093). */
export function chosenChipColors(colors: ThemeColors) {
  const control = controlColors(colors);
  return { borderColor: control.border, backgroundColor: control.fill };
}

