/**
 * What the image viewer's top bar says (TR-042's caption slot, TR-055): a heading and the caption
 * under it. Opened from a decision option, the heading names the option and where in its images
 * the viewer is; otherwise it is the position alone, or nothing for a single image, which then shows
 * its caption as the heading.
 */
export interface ViewerBarText {
  heading: string | null;
  caption: string;
}

/** An image's caption as shown; an image without one is called "Image". */
export function captionOf(alt: string): string {
  return alt.trim() === "" ? "Image" : alt;
}

export function viewerBarText({ title, alt, index, count }: { title?: string | undefined; alt: string; index: number; count: number }): ViewerBarText {
  const position = count > 1 ? `${index + 1} of ${count}` : null;
  const named = title === undefined || title.trim() === "" ? null : title.trim();
  const heading = named === null ? position : position === null ? named : `${named} · ${position}`;
  return { heading, caption: captionOf(alt) };
}
