/**
 * The pieces the add-project and project-settings page is drawn with (TR-019): a section card with
 * an icon and a description, a field with its label beside the control on a wide page and above it
 * on a narrow one, radio cards, a dropdown and a text field. The host's settings rows put every
 * control in a row's trailing slot, which leaves no room for descriptions or choices with text.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { addableModelGroups, type PickerOption } from "../shared/model-picker";
import { KeyboardRevealBoundary, useRevealFocused } from "./keyboard";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { IconButton, MONOSPACE } from "./ui";
import { FONT_SIZE, lineHeightFor } from "./type-scale";

/** Below this page width a field's label goes above its control instead of beside it. */
export const TWO_COLUMN_MIN_WIDTH = 600;
const LABEL_COLUMN_WIDTH = 170;
const CONTROL_HEIGHT = 36;

export function FormSection({
  theme,
  icon,
  title,
  description,
  tag,
  trailing,
  children,
}: {
  theme: PluginTheme;
  /** A Lucide name drawn in a small tile before the title. */
  icon: string;
  title: string;
  description?: string;
  /** A muted word after the title, such as "optional". */
  tag?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const colors = theme.colors;
  const styles = useMemo(
    () => ({
      card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface1, padding: SPACE.lg, gap: SPACE.lg },
      header: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: SPACE.md },
      tile: {
        width: 28,
        height: 28,
        borderRadius: 8,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: colors.surface2,
      },
      titles: { flex: 1, gap: SPACE.xxs },
      titleRow: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: SPACE.sm, minHeight: 28 },
      title: { color: colors.foreground, fontSize: FONT_SIZE.subtitle, fontWeight: "600" as const, lineHeight: 28 },
      tag: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small },
      description: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) },
    }),
    [colors],
  );
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.tile}>
          <Icon name={icon} size={16} color={colors.foreground} />
        </View>
        <View style={styles.titles}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            {tag === undefined ? null : <Text style={styles.tag}>{tag}</Text>}
          </View>
          {description === undefined ? null : <Text style={styles.description}>{description}</Text>}
        </View>
        {trailing}
      </View>
      {children}
    </View>
  );
}

export function Field({
  theme,
  wide,
  label,
  hint,
  error,
  children,
}: {
  theme: PluginTheme;
  /** Label beside the control (a wide page) rather than above it. */
  wide: boolean;
  label: string;
  hint?: string | null;
  /** Shown instead of the hint, in the danger colour. */
  error?: string | null;
  children: ReactNode;
}) {
  const colors = theme.colors;
  const failing = error !== undefined && error !== null;
  const note = failing ? error : (hint ?? null);
  return (
    <View style={{ flexDirection: wide ? "row" : "column", gap: wide ? SPACE.lg : SPACE.xs }}>
      <Text
        style={{
          width: wide ? LABEL_COLUMN_WIDTH : undefined,
          // Lines the label up with the text inside a control on the same row.
          paddingTop: wide ? SPACE.sm : 0,
          color: colors.foreground,
          fontSize: FONT_SIZE.body,
          fontWeight: "500",
        }}
      >
        {label}
      </Text>
      <View style={{ flex: wide ? 1 : undefined, gap: SPACE.xs, minWidth: 0 }}>
        {children}
        {note === null ? null : (
          <Text style={{ color: failing ? colors.statusDanger : colors.foregroundMuted, fontSize: FONT_SIZE.caption, lineHeight: lineHeightFor(FONT_SIZE.caption) }}>
            {note}
          </Text>
        )}
      </View>
    </View>
  );
}

/** A read-only value where a field would be: a project's name or repository, fixed once it exists. */
export function FixedValue({ theme, text, monospace = false }: { theme: PluginTheme; text: string; monospace?: boolean }) {
  return (
    <Text
      selectable
      style={{
        paddingTop: SPACE.sm,
        color: theme.colors.foreground,
        fontSize: FONT_SIZE.body,
        fontFamily: monospace ? MONOSPACE : undefined,
      }}
    >
      {text}
    </Text>
  );
}

export function TextField({
  theme,
  value,
  onChangeText,
  placeholder,
  invalid = false,
  multiline = false,
  autoFocus = false,
  accessibilityLabel,
}: {
  theme: PluginTheme;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  invalid?: boolean;
  multiline?: boolean;
  autoFocus?: boolean;
  accessibilityLabel: string;
}) {
  const colors = theme.colors;
  const reveal = useRevealFocused();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onFocus={reveal}
      placeholder={placeholder}
      placeholderTextColor={colors.foregroundMuted}
      accessibilityLabel={accessibilityLabel}
      autoCapitalize="none"
      autoCorrect={false}
      multiline={multiline}
      autoFocus={autoFocus}
      style={{
        minHeight: multiline ? 120 : CONTROL_HEIGHT,
        paddingHorizontal: SPACE.md,
        paddingVertical: SPACE.sm,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: invalid ? colors.statusDanger : colors.border,
        backgroundColor: colors.surface0,
        color: colors.foreground,
        fontSize: FONT_SIZE.body,
        lineHeight: multiline ? lineHeightFor(FONT_SIZE.body) : undefined,
        textAlignVertical: multiline ? "top" : "center",
      }}
    />
  );
}

export interface Choice<Value extends string> {
  value: Value;
  title: string;
  description: string;
}

/** A radio group drawn as cards, each choice with a sentence on what it means. */
export function ChoiceCards<Value extends string>({
  theme,
  value,
  options,
  onChange,
}: {
  theme: PluginTheme;
  value: Value;
  options: ReadonlyArray<Choice<Value>>;
  onChange: (value: Value) => void;
}) {
  const colors = theme.colors;
  return (
    <View accessibilityRole="radiogroup" style={{ gap: SPACE.sm }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: SPACE.md,
              padding: SPACE.md,
              borderWidth: 1,
              borderRadius: 10,
              borderColor: selected ? colors.accent : colors.border,
              backgroundColor: selected ? withAlpha(colors.accent, 0.1) : colors.surface0,
            }}
          >
            <View
              style={{
                marginTop: 2,
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 1.5,
                borderColor: selected ? colors.accent : colors.foregroundMuted,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {selected ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} /> : null}
            </View>
            <View style={{ flex: 1, gap: SPACE.xxs }}>
              <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: "600" }}>{option.title}</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small, lineHeight: lineHeightFor(FONT_SIZE.small) }}>{option.description}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A select: a control showing the chosen label that opens the host's modal with every option. */
export function Dropdown<Value extends string>({
  theme,
  title,
  value,
  options,
  onChange,
}: {
  theme: PluginTheme;
  /** The modal's title and the control's accessibility label. */
  title: string;
  value: Value;
  options: ReadonlyArray<{ label: string; value: Value }>;
  onChange: (value: Value) => void;
}) {
  const colors = theme.colors;
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value)?.label ?? (value === "" ? "—" : value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${chosen}`}
        disabled={options.length === 0}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: SPACE.sm,
          height: CONTROL_HEIGHT,
          paddingHorizontal: SPACE.md,
          borderWidth: 1,
          borderRadius: 8,
          borderColor: colors.border,
          backgroundColor: colors.surface0,
          opacity: options.length === 0 ? 0.6 : 1,
        }}
      >
        <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: FONT_SIZE.body }}>
          {chosen}
        </Text>
        <Icon name="ChevronDown" size={14} color={colors.foregroundMuted} />
      </Pressable>
      <Modal title={title} open={open} onOpenChange={setOpen}>
        <Modal.Content contentContainerStyle={{ padding: SPACE.sm, gap: SPACE.xxs }}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: SPACE.md,
                  paddingHorizontal: SPACE.md,
                  paddingVertical: SPACE.md,
                  borderRadius: 8,
                  backgroundColor: selected ? colors.surface2 : "transparent",
                }}
              >
                <Text style={{ flex: 1, color: colors.foreground, fontSize: FONT_SIZE.body, fontWeight: selected ? "600" : "400" }}>{option.label}</Text>
                {selected ? <Icon name="Check" size={16} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </Modal.Content>
      </Modal>
    </>
  );
}

/** One prerequisite: a tick or a cross, its name and what was found. */
export function CheckLine({ theme, ok, name, detail }: { theme: PluginTheme; ok: boolean; name: string; detail: string }) {
  const colors = theme.colors;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={ok ? "CircleCheck" : "CircleX"} size={16} color={ok ? colors.statusSuccess : colors.statusDanger} />
      </View>
      <Text style={{ flex: 1, color: colors.foreground, fontSize: FONT_SIZE.body, lineHeight: lineHeightFor(FONT_SIZE.body) }}>
        {name}
        {detail === "" ? null : <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>{`  ${detail}`}</Text>}
      </Text>
    </View>
  );
}

/**
 * The models owners may give subagents: the chosen ones as removable chips and an "Add model"
 * button opening a searchable list grouped by provider. A host can list dozens of models; showing
 * each as a chip made a wall of them (TR-019).
 */
export function ModelChooser({
  theme,
  options,
  selected,
  onAdd,
  onRemove,
  emptyText,
}: {
  theme: PluginTheme;
  /** Every model, the chosen ones included (unlisted saved ones too, so they can be removed). */
  options: readonly PickerOption[];
  selected: readonly string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  /** What an empty choice means. */
  emptyText: string;
}) {
  const colors = theme.colors;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const groups = addableModelGroups(options, selected, query);
  const labelOf = (value: string) => options.find((option) => option.value === value)?.label ?? value;
  return (
    <View style={{ gap: SPACE.sm }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm }}>
        {selected.length === 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>{emptyText}</Text> : null}
        {selected.map((value) => (
          <View
            key={value}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: SPACE.xs,
              height: 28,
              paddingLeft: SPACE.md,
              paddingRight: SPACE.xs,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.accent,
              backgroundColor: withAlpha(colors.accent, 0.1),
            }}
          >
            <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.small, fontWeight: "500" }}>{labelOf(value)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${labelOf(value)}`} hitSlop={6} onPress={() => onRemove(value)} style={{ padding: SPACE.xxs }}>
              <Icon name="X" size={14} color={colors.foregroundMuted} />
            </Pressable>
          </View>
        ))}
        <IconButton theme={theme} icon="Plus" label="Add model" showLabel disabled={options.length === selected.length} onPress={() => setOpen(true)} />
      </View>
      <Modal
        title="Add a subagent model"
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <Modal.Content contentContainerStyle={{ padding: SPACE.md, gap: SPACE.md }}>
          {/* The host keeps a modal's field above the keyboard; the page behind stays put. */}
          <KeyboardRevealBoundary>
            <TextField theme={theme} accessibilityLabel="Search models" value={query} onChangeText={setQuery} placeholder="Search models" />
          </KeyboardRevealBoundary>
          {groups.length === 0 ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>{query.trim() === "" ? "Every model is chosen." : "No model matches."}</Text>
          ) : null}
          {groups.map((group) => (
            <View key={group.provider} style={{ gap: SPACE.xxs }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.micro, fontWeight: "700", letterSpacing: 0.8, paddingHorizontal: SPACE.md, paddingBottom: SPACE.xs }}>
                {group.provider.toUpperCase()}
              </Text>
              {group.options.map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="menuitem"
                  accessibilityLabel={`Add ${group.provider} ${option.label}`}
                  onPress={() => onAdd(option.value)}
                  style={{ flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm + 2, borderRadius: 8 }}
                >
                  <Text style={{ flex: 1, color: colors.foreground, fontSize: FONT_SIZE.body }}>{option.label}</Text>
                  <Icon name="Plus" size={14} color={colors.foregroundMuted} />
                </Pressable>
              ))}
            </View>
          ))}
        </Modal.Content>
      </Modal>
    </View>
  );
}
