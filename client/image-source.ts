/** Where an image's bytes come from, as `ImageThumbnail` and the viewer take it (`./image-view`). */
export type ImageSource = { kind: "local"; path: string } | { kind: "remote"; uri: string } | { kind: "inline"; uri: string } | { kind: "none" };

/** A daemon file is read through `taro.image.read`; an `https://` image and a composer attachment's `data:image/…;base64,` (TR-192) are drawn as they are. */
export function sourceOf(source: string): ImageSource {
  if (source.startsWith("file://") || source.startsWith("/")) return { kind: "local", path: source };
  if (source.startsWith("https://")) return { kind: "remote", uri: source };
  if (/^data:image\/[^;,]+(?:;[^;,]*)*;base64,/.test(source)) return { kind: "inline", uri: source };
  return { kind: "none" };
}
