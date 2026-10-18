/**
 * Paseo's web shimmer on a plugin's words (TR-184): a copy of the words with no fill of its own,
 * showing a white gradient clipped to its letters, the gradient sliding across them.
 *
 * Ported from Paseo (5293dda, Apache-2.0): `buildShimmerTextStyle` and its keyframes in
 * `packages/app/src/components/message.tsx`. Changed: the style is set on the copy's elements, as a
 * plugin's style props do not reach CSS text clipping, and the slide is a Web Animation on each
 * element rather than a keyframes rule added to the page.
 */
import { SHIMMER_GRADIENT, webShimmerTrack } from "./shimmer";

/** The few features of a DOM element this uses: a react-native-web view's node has them. */
export interface ShimmerElement {
  getBoundingClientRect(): { left: number; right: number };
  childNodes: ArrayLike<{ nodeType: number; textContent: string | null }>;
  style: { setProperty(name: string, value: string): void };
  animate?(keyframes: { backgroundPosition: string }[], options: { duration: number; iterations: number; easing: string }): { cancel(): void };
  ownerDocument?: { createRange?(): { selectNodeContents(node: unknown): void; getBoundingClientRect(): { right: number } } };
}

export interface ShimmerContainer {
  getBoundingClientRect(): { left: number; right: number };
  querySelectorAll(selector: string): ArrayLike<ShimmerElement>;
}

const TEXT_NODE = 3;

/** Whether this browser clips a background to text and runs Web Animations; without both the copy is not drawn. */
export function webShimmerSupported(): boolean {
  const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS;
  const element = (globalThis as { Element?: { prototype?: { animate?: unknown } } }).Element;
  if (typeof css?.supports !== "function" || typeof element?.prototype?.animate !== "function") return false;
  return css.supports("background-clip", "text") || css.supports("-webkit-background-clip", "text");
}

/** The elements that draw letters themselves: a text node of their own with something in it. */
function letterElements(container: ShimmerContainer): ShimmerElement[] {
  return Array.from(container.querySelectorAll("*")).filter((element) =>
    Array.from(element.childNodes).some((node) => node.nodeType === TEXT_NODE && (node.textContent ?? "").trim() !== ""),
  );
}

/**
 * Where an element's letters end: a text stretched to fill its row (the command, so it is cut with
 * "…" at the row's end) ends far past them, and Paseo's band ends at the last letter. Cut text ends
 * at the element's edge.
 */
function lettersRight(element: ShimmerElement): number {
  const box = element.getBoundingClientRect().right;
  const range = element.ownerDocument?.createRange?.();
  if (range === undefined) return box;
  range.selectNodeContents(element);
  const right = range.getBoundingClientRect().right;
  return right > 0 ? Math.min(box, right) : box;
}

/**
 * Starts the shimmer over the words in `container` (a copy laid over them), one crossing every
 * `durationMs`; returns what stops it. One band crosses all the words: each element's gradient is
 * placed by its own offset in the row, so the band runs on from the label into the command.
 */
export function startWebShimmer(container: unknown, durationMs: number): () => void {
  if (typeof container !== "object" || container === null || typeof (container as ShimmerContainer).querySelectorAll !== "function") return () => undefined;
  const row = container as ShimmerContainer;
  const elements = letterElements(row);
  if (elements.length === 0) return () => undefined;
  const rowLeft = row.getBoundingClientRect().left;
  const offsets = elements.map((element) => element.getBoundingClientRect().left - rowLeft);
  const spanEnd = Math.max(...elements.map((element) => lettersRight(element) - rowLeft));
  const { peakWidth, trackStart, trackEnd } = webShimmerTrack(Math.min(...offsets), spanEnd);
  const animations = elements.map((element, index) => {
    const offset = offsets[index] ?? 0;
    const style = element.style;
    style.setProperty("opacity", "1");
    style.setProperty("-webkit-text-fill-color", "transparent");
    style.setProperty("background-image", SHIMMER_GRADIENT);
    style.setProperty("background-size", `${peakWidth}px 100%`);
    style.setProperty("background-repeat", "no-repeat");
    style.setProperty("background-position", `${trackStart - offset}px 0`);
    style.setProperty("-webkit-background-clip", "text");
    style.setProperty("background-clip", "text");
    return element.animate?.([{ backgroundPosition: `${trackStart - offset}px 0` }, { backgroundPosition: `${trackEnd - offset}px 0` }], {
      duration: durationMs,
      iterations: Infinity,
      easing: "linear",
    });
  });
  return () => animations.forEach((animation) => animation?.cancel());
}
