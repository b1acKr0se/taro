/**
 * Which images the user sent with which message. Paseo's timeline keeps only a message's words,
 * so the images come from `taro.agent.sent-images` and are matched to the chat's rows by text,
 * counting from the newest: the n-th last user row with some words takes the n-th last sent
 * message with the same words. The chat holds only the timeline's tail, so counting from the start
 * would shift once older rows fall out of it.
 */
import type { SentImagesMessage } from "../shared/contracts";
import { ATTACHMENTS_ONLY } from "./transcript-rows";

export type SentImage = SentImagesMessage["images"][number];

/** The sent images of each user row that has any, by row key. */
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
  [...rows].reverse().forEach((row) => {
    if (row.kind !== "user") return;
    const text = row.text === ATTACHMENTS_ONLY ? "" : row.text.trim();
    const fromEnd = seen.get(text) ?? 0;
    seen.set(text, fromEnd + 1);
    const sent = byText.get(text) ?? [];
    const images = sent[sent.length - 1 - fromEnd];
    if (images !== undefined && images.length > 0) matched.set(row.key, images);
  });
  return matched;
}
