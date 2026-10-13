/**
 * Which images the captain sent with which message. Paseo's timeline keeps only a message's words,
 * so the images come from `taro.agent.sent-images` and are matched to the chat's rows by text: the
 * n-th captain row with some words takes the n-th sent message with the same words.
 */
import type { SentImagesMessage } from "../shared/contracts";
import { ATTACHMENTS_ONLY } from "./transcript-rows";

export type SentImage = SentImagesMessage["images"][number];

/** The sent images of each captain row that has any, by row key. */
export function matchSentImages(
  rows: readonly { key: string; kind: string; text: string }[],
  messages: readonly SentImagesMessage[],
): Map<string, SentImage[]> {
  const byText = new Map<string, SentImage[][]>();
  messages.forEach((message) => {
    const text = message.text.trim();
    byText.set(text, [...(byText.get(text) ?? []), message.images]);
  });
  const seen = new Map<string, number>();
  const matched = new Map<string, SentImage[]>();
  rows.forEach((row) => {
    if (row.kind !== "captain") return;
    const text = row.text === ATTACHMENTS_ONLY ? "" : row.text.trim();
    const index = seen.get(text) ?? 0;
    seen.set(text, index + 1);
    const images = byText.get(text)?.[index];
    if (images !== undefined && images.length > 0) matched.set(row.key, images);
  });
  return matched;
}
