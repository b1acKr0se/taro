/**
 * The composer's attachments (TR-036): the + button inside the box, the "Add attachment" sheet it
 * opens — a bottom sheet on a phone, a popover over the + on a wide screen, as Paseo's own — and the
 * removable previews of what is attached. What each item does is in `attachment-pickers.ts`.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useRef, useState } from "react";
import { Image, Modal, SafeAreaView, ScrollView, Text, View, useWindowDimensions } from "react-native";

import { base64ByteLength, formatBytes, type DraftAttachment } from "../shared/attachments";
import { ATTACHMENT_SOURCES, type AttachmentSource } from "./attachment-sources";
import { COMPOSER_CONTROL_SIZE } from "./composer-height";
import { Pressable } from "./focus";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE } from "./type-scale";

const PREVIEW_SIZE = 56;
const POPOVER_WIDTH = 220;

interface Anchor {
  x: number;
  y: number;
}

/** The + and the sheet it opens. `sources` is read when the sheet opens, so a module that is missing then is not offered. */
export function AttachButton({
  theme,
  compact,
  iconSize,
  disabled,
  sources,
  onBeforeOpen,
  onPick,
}: {
  theme: PluginTheme;
  compact: boolean;
  /** The composer's icon size, shared with the send button (TR-039). */
  iconSize: number;
  disabled: boolean;
  sources: () => AttachmentSource[];
  /** Runs before the sheet shows (a phone puts its keyboard away). */
  onBeforeOpen?: (() => void) | undefined;
  onPick: (source: AttachmentSource) => void;
}) {
  const button = useRef<View>(null);
  const [open, setOpen] = useState<{ sources: AttachmentSource[]; anchor: Anchor | null } | null>(null);
  const { colors } = theme;

  function show(): void {
    onBeforeOpen?.();
    const offered = sources();
    if (compact || button.current === null) {
      setOpen({ sources: offered, anchor: null });
      return;
    }
    button.current.measureInWindow((x, y) => setOpen({ sources: offered, anchor: { x, y } }));
  }

  return (
    <>
      <View ref={button} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add attachment"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={show}
          style={({ pressed }) => ({
            width: COMPOSER_CONTROL_SIZE,
            height: COMPOSER_CONTROL_SIZE,
            borderRadius: COMPOSER_CONTROL_SIZE / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed || open !== null ? colors.surface2 : "transparent",
            opacity: disabled ? 0.5 : 1,
          })}
        >
          <Icon name="Plus" size={iconSize} color={colors.foregroundMuted} />
        </Pressable>
      </View>
      <AttachmentSheet
        theme={theme}
        open={open}
        onClose={() => setOpen(null)}
        onPick={(source) => {
          setOpen(null);
          onPick(source);
        }}
      />
    </>
  );
}

function AttachmentSheet({
  theme,
  open,
  onClose,
  onPick,
}: {
  theme: PluginTheme;
  open: { sources: AttachmentSource[]; anchor: Anchor | null } | null;
  onClose: () => void;
  onPick: (source: AttachmentSource) => void;
}) {
  const window = useWindowDimensions();
  const { colors } = theme;
  const anchor = open?.anchor ?? null;
  const styles = useMemo(
    () => ({
      backdrop: { flex: 1, justifyContent: "flex-end" as const, backgroundColor: anchor === null ? withAlpha(colors.surface0, 0.6) : "transparent" },
      sheet: {
        backgroundColor: colors.surface1,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: colors.border,
        paddingTop: SPACE.sm,
        paddingBottom: SPACE.md,
      },
      handle: { alignSelf: "center" as const, width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: SPACE.md },
      popover: {
        position: "absolute" as const,
        width: POPOVER_WIDTH,
        backgroundColor: colors.surface1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        paddingVertical: SPACE.xs,
      },
      title: { color: colors.foreground, fontSize: FONT_SIZE.content, fontWeight: "600" as const, paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: SPACE.md, paddingHorizontal: SPACE.lg },
      label: { color: colors.foreground },
      empty: { color: colors.foregroundMuted, fontSize: FONT_SIZE.small, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm },
    }),
    [colors, anchor === null],
  );
  if (open === null) return null;
  const items = ATTACHMENT_SOURCES.filter((item) => open.sources.includes(item.source));
  const rows = (rowHeight: number, fontSize: number, iconSize: number) =>
    items.length === 0 ? (
      <Text style={styles.empty}>This app offers no way to attach files here.</Text>
    ) : (
      items.map((item) => (
        <Pressable
          key={item.source}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          onPress={() => onPick(item.source)}
          style={({ pressed }) => [styles.row, { height: rowHeight }, pressed ? { backgroundColor: colors.surface2 } : null]}
        >
          <Icon name={item.icon} size={iconSize} color={colors.foregroundMuted} />
          <Text style={[styles.label, { fontSize }]}>{item.label}</Text>
        </Pressable>
      ))
    );
  return (
    <Modal visible transparent animationType={anchor === null ? "slide" : "fade"} onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose}>
        {anchor === null ? (
          // A press on the sheet itself must not reach the backdrop behind it.
          <Pressable onPress={() => undefined} style={styles.sheet}>
            <SafeAreaView>
              <View style={styles.handle} />
              <Text style={styles.title}>Add attachment</Text>
              {rows(52, FONT_SIZE.content, 20)}
            </SafeAreaView>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => undefined}
            accessibilityLabel="Add attachment"
            style={[styles.popover, { left: Math.max(SPACE.sm, Math.min(anchor.x, window.width - POPOVER_WIDTH - SPACE.sm)), bottom: window.height - anchor.y + SPACE.xs }]}
          >
            {rows(36, FONT_SIZE.body, 16)}
          </Pressable>
        )}
      </Pressable>
    </Modal>
  );
}

/** The attachments waiting to be sent, each with a remove button; nothing when there are none. */
export function AttachmentPreviews({ theme, attachments, onRemove }: { theme: PluginTheme; attachments: readonly DraftAttachment[]; onRemove: (id: string) => void }) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      strip: { flexGrow: 0 },
      stripBody: { gap: SPACE.sm, paddingHorizontal: SPACE.sm, paddingTop: SPACE.sm },
      image: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
      file: {
        height: PREVIEW_SIZE,
        maxWidth: 220,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: SPACE.sm,
        paddingLeft: SPACE.sm,
        paddingRight: SPACE.lg + SPACE.xs,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
      },
      fileName: { color: colors.foreground, fontSize: FONT_SIZE.small },
      fileSize: { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption },
      remove: {
        position: "absolute" as const,
        top: 2,
        right: 2,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        backgroundColor: withAlpha(colors.surface0, 0.85),
        borderWidth: 1,
        borderColor: colors.border,
      },
    }),
    [colors],
  );
  if (attachments.length === 0) return null;
  return (
    <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.stripBody} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {attachments.map((attachment) => (
        <View key={attachment.id}>
          {attachment.kind === "image" ? (
            <Image accessibilityLabel={attachment.fileName} source={{ uri: `data:${attachment.mimeType};base64,${attachment.data}` }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={styles.file}>
              <Icon name="File" size={18} color={colors.foregroundMuted} />
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {attachment.fileName}
                </Text>
                <Text style={styles.fileSize}>{formatBytes(base64ByteLength(attachment.data))}</Text>
              </View>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${attachment.fileName}`}
            hitSlop={8}
            style={styles.remove}
            onPress={() => onRemove(attachment.id)}
          >
            <Icon name="X" size={12} color={colors.foreground} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * What a chat pane shows while files are dragged over it (TR-099), as Paseo's `FileDropBackdrop`:
 * the pane dimmed, an upload icon and "Drop files here" in its middle, fading in and out. It takes no
 * presses, so the drag events reach the pane under it.
 */
export function DropBackdrop({ theme, active }: { theme: PluginTheme; active: boolean }) {
  const { colors } = theme;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden={!active}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        opacity: active ? 1 : 0,
        // React Native Web's CSS transition; drops happen only there.
        ...({ transitionProperty: "opacity", transitionDuration: "150ms" } as object),
      }}
    >
      <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.surface0, opacity: 0.7 }} />
      <View style={{ alignItems: "center", gap: SPACE.sm }}>
        <Icon name="Upload" size={32} color={colors.accent} />
        <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.content, fontWeight: "500" }}>Drop files here</Text>
      </View>
    </View>
  );
}
