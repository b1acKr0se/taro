/**
 * An image in a chat (and, from TR-021.02, in a ticket's evidence): a thumbnail that opens full
 * size. The client cannot read the daemon's disk, so a `file://` URI or an absolute path is read
 * through `taro.image.read`, which serves only the directories Taro's images live in; an `https://`
 * image loads directly.
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";

import { readImageRpc } from "../shared/contracts";
import { SPACE } from "./spacing";
import { withAlpha } from "./tint";
import { FONT_SIZE } from "./type-scale";

const THUMBNAIL_HEIGHT = 160;

type ImageSource = { kind: "local"; path: string } | { kind: "remote"; uri: string } | { kind: "none" };

function sourceOf(source: string): ImageSource {
  if (source.startsWith("file://") || source.startsWith("/")) return { kind: "local", path: source };
  if (source.startsWith("https://")) return { kind: "remote", uri: source };
  return { kind: "none" };
}

/** The image as a URI the `Image` component can draw: undefined while loading, null when it cannot be had. */
function useImageUri(source: ImageSource): string | null | undefined {
  const read = useRpc(readImageRpc);
  const path = source.kind === "local" ? source.path : "";
  const query = useQuery({
    queryKey: ["taro", "image", path] as const,
    queryFn: () => read({ path }),
    enabled: source.kind === "local",
    // An image file does not change under its name: evidence and sent images are written once.
    staleTime: Infinity,
    retry: 1,
  });
  if (source.kind === "remote") return source.uri;
  if (source.kind === "none") return null;
  if (query.isError) return null;
  if (query.data === undefined) return undefined;
  return query.data.image === null ? null : `data:${query.data.image.mimeType};base64,${query.data.image.data}`;
}

/** Width over height once known, so the thumbnail keeps the image's shape. */
function useAspectRatio(uri: string | null | undefined): number | null {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    if (typeof uri !== "string") return;
    let current = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (current && width > 0 && height > 0) setRatio(width / height);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [uri]);
  return ratio;
}

export function ImageThumbnail({ source, alt, theme }: { source: string; alt: string; theme: PluginTheme }) {
  const kind = useMemo(() => sourceOf(source), [source]);
  const uri = useImageUri(kind);
  const ratio = useAspectRatio(uri);
  const [open, setOpen] = useState(false);
  const { colors } = theme;
  const label = alt.trim() === "" ? "Image" : alt;
  const frame = {
    height: THUMBNAIL_HEIGHT,
    width: THUMBNAIL_HEIGHT * (ratio ?? 4 / 3),
    maxWidth: "100%" as const,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    overflow: "hidden" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };
  const note = { color: colors.foregroundMuted, fontSize: FONT_SIZE.caption, padding: SPACE.sm, textAlign: "center" as const };

  if (kind.kind === "none") return <Text style={{ color: colors.foregroundMuted, fontSize: FONT_SIZE.small }}>[{label}]</Text>;
  if (uri === undefined) return <View accessibilityLabel={`${label}, loading`} style={frame} />;
  if (uri === null) {
    return (
      <View accessibilityLabel={`${label}: image not available`} style={frame}>
        <Text style={note}>Image not available</Text>
      </View>
    );
  }
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${label}, open full size`} style={frame} onPress={() => setOpen(true)}>
        <Image source={{ uri }} accessibilityLabel={label} resizeMode="cover" style={{ width: "100%", height: "100%" }} />
      </Pressable>
      <ImageModal uri={open ? uri : null} alt={label} theme={theme} onClose={() => setOpen(false)} />
    </>
  );
}

/** The image fit to the screen; a press on it, on the backdrop or on Close closes it. */
export function ImageModal({ uri, alt, theme, onClose }: { uri: string | null; alt: string; theme: PluginTheme; onClose: () => void }) {
  const { colors } = theme;
  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close the image"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: withAlpha(colors.surface0, 0.94), padding: SPACE.lg, gap: SPACE.md }}
      >
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={{ paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}
          >
            <Text style={{ color: colors.foreground, fontSize: FONT_SIZE.small }}>Close</Text>
          </Pressable>
        </View>
        {uri === null ? null : <Image source={{ uri }} accessibilityLabel={alt} resizeMode="contain" style={{ flex: 1, width: "100%" }} />}
      </Pressable>
    </Modal>
  );
}
