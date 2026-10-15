/**
 * An agent's timeline, turned into the rows the chat pane draws. From
 * FirstMate's `client/transcript-rows.ts` (MIT); "user" rows are the user's
 * words and "agent" rows the agent's.
 *
 * The full transcript is one click away — the pane's Open button shows the
 * agent in Paseo itself, with every tool call and its output. This pane
 * is for the conversation with the user, so it keeps the words and folds
 * the machinery: a tool call is one line, reasoning is left out, and the
 * notes Paseo and the board inject into the agent's inbox are shown as
 * the one line that says what happened rather than as the raw envelope.
 */
import type { usePaseo } from "@getpaseo/plugin/client";

import { imageLineOf } from "./markdown-parse";

type PaseoApi = ReturnType<typeof usePaseo>;
export type TimelinePage = Awaited<ReturnType<ReturnType<PaseoApi["agents"]["ref"]>["timeline"]["refetch"]>>;
export type TimelineEntry = TimelinePage["entries"][number];
type TimelineItem = TimelineEntry["item"];
type ToolCallItem = Extract<TimelineItem, { type: "tool_call" }>;

export type TranscriptRow =
  | { key: string; kind: "user"; text: string }
  | { key: string; kind: "agent"; text: string }
  | { key: string; kind: "event"; text: string }
  | { key: string; kind: "tool"; text: string; status: ToolCallItem["status"] }
  | { key: string; kind: "error"; text: string };

/** A user row's text when the message had attachments and no words. */
export const ATTACHMENTS_ONLY = "(attachments)";

/** Envelopes a message is wrapped in when it did not come from the user. */
const ENVELOPES = ["paseo-system", "taro"] as const;

/**
 * The first line inside an injected note — "Agent 3f2a… (Fix login) finished." — or null for the user's
 * own words. `clientMessageId` is the timeline item's: only a message the plugin sent as a watch message
 * is folded as one, so the user's words stay visible even when they look like a watch note.
 */
export function injectedSummary(text: string, clientMessageId?: string): string | null {
  const trimmed = text.trim();
  void clientMessageId;
  for (const tag of ENVELOPES) {
    if (!trimmed.startsWith(`<${tag}>`)) continue;
    const body = trimmed.slice(tag.length + 2).replace(new RegExp(`</${tag}>\\s*$`), "");
    const first = body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("<"));
    return first ?? tag;
  }
  return null;
}

/** One line, at most `max` characters. */
export function clip(text: string, max = 120): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

/** One line for a tool call: what it did, in the fewest words its detail allows. */
export function toolSummary(item: ToolCallItem): string {
  const detail = item.detail;
  switch (detail.type) {
    case "shell":
      return `$ ${clip(detail.command, 100)}`;
    case "read":
      return `Read ${detail.filePath}`;
    case "edit":
      return `Edit ${detail.filePath}`;
    case "write":
      return `Write ${detail.filePath}`;
    case "search":
      return `Search ${clip(detail.query, 80)}`;
    case "fetch":
      return `Fetch ${detail.url}`;
    case "sub_agent":
      return `Agent ${clip(detail.description ?? detail.subAgentType ?? "", 80)}`.trim();
    case "plain_text":
      return clip(detail.label ?? detail.text ?? item.name, 100);
    case "plan":
      return "Plan";
    default:
      return toolDisplayName(item.name);
  }
}

/** MCP tools arrive as `mcp__paseo__create_agent`; the server name is noise. */
export function toolDisplayName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
}

const COMPACTING = "Compacting context…";
/** A compaction cut short (a message sent during it, an interrupt): Paseo never says it ended (TR-102). */
const COMPACTION_STOPPED = "Compaction stopped before it finished";

/**
 * Adds a compaction's line to `rows`. A compaction arrives as two entries, one
 * as it starts and one as it ends, and the second takes the first's place, so
 * a finished compaction is one line rather than two.
 */
export function pushCompaction<Row extends { kind: string; text?: string; key: string }>(
  rows: Row[],
  key: string,
  status: "loading" | "completed",
  make: (key: string, text: string) => Row,
): void {
  const last = rows[rows.length - 1];
  if (status === "completed" && last !== undefined && last.kind === "event" && last.text === COMPACTING) {
    rows[rows.length - 1] = make(last.key, "Context compacted");
    return;
  }
  rows.push(make(key, status === "loading" ? COMPACTING : "Context compacted"));
}

/**
 * A row's key: where its entry starts in the timeline. The end moves while a
 * reply streams or a tool call runs, and a position in the page shifts once
 * the tail is full, so neither is in it — a key that changes remounts the row
 * and forgets that it was open.
 */
export function rowKey(entry: TimelineEntry): string {
  return String(entry.seqStart);
}

/**
 * An image the agent read arrives as an assistant message of its own, `![Image](file://…)`; in a
 * merged row it keeps a line to itself, with a blank line on each side, so it parses as an image.
 */
function appendAssistantText(text: string, piece: string): string {
  if (imageLineOf(piece) === null) return text + piece;
  return `${text.trim() === "" ? "" : `${text.replace(/\s+$/, "")}\n\n`}${piece.trim()}\n\n`;
}

/**
 * Whether `entry` is a reply of its own rather than the next piece of `previous`. Paseo merges the
 * pieces of one streamed message by the same rule (next sequence number, same turn, same message
 * id), so entries still apart are separate replies, which would otherwise run together ("…the userok").
 */
function startsNewReply(previous: TimelineEntry | undefined, entry: TimelineEntry): boolean {
  if (previous === undefined || previous.item.type !== "assistant_message" || entry.item.type !== "assistant_message") {
    return true;
  }
  const messageId = entry.item.messageId;
  return (
    previous.seqEnd + 1 !== entry.seqStart ||
    previous.turnId !== entry.turnId ||
    (messageId !== undefined && messageId !== previous.item.messageId)
  );
}

/** A separate reply in a merged row starts its own paragraph. */
function appendReply(text: string, piece: string): string {
  if (text.trim() === "") return appendAssistantText("", piece);
  return appendAssistantText(`${text.replace(/\s+$/, "")}\n\n`, piece.replace(/^\s+/, ""));
}

/**
 * Timeline entries to rows. Consecutive assistant messages are one row, since
 * a streamed reply can arrive in several pieces that split anywhere; a separate
 * reply in that row starts a new paragraph.
 */
export function transcriptRows(entries: readonly TimelineEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let previousReply: TimelineEntry | undefined;
  entries.forEach((entry) => {
    const key = rowKey(entry);
    const item = entry.item;
    switch (item.type) {
      case "user_message": {
        const summary = injectedSummary(item.text, item.clientMessageId);
        // A message of attachments alone has no words; the row still says the user sent something.
        const text = item.text.trim() === "" ? ATTACHMENTS_ONLY : item.text;
        rows.push(summary === null ? { key, kind: "user", text } : { key, kind: "event", text: summary });
        break;
      }
      case "assistant_message": {
        const last = rows[rows.length - 1];
        if (last === undefined || last.kind !== "agent") rows.push({ key, kind: "agent", text: appendAssistantText("", item.text) });
        else if (startsNewReply(previousReply, entry)) last.text = appendReply(last.text, item.text);
        else last.text = appendAssistantText(last.text, item.text);
        previousReply = entry;
        break;
      }
      case "tool_call":
        rows.push({ key, kind: "tool", text: toolSummary(item), status: item.status });
        break;
      case "error":
        rows.push({ key, kind: "error", text: item.message });
        break;
      case "notification":
        rows.push({ key, kind: item.level === "error" ? "error" : "event", text: item.message });
        break;
      case "compaction":
        pushCompaction(rows, key, item.status, (rowKey, text) => ({ key: rowKey, kind: "event" as const, text }));
        break;
      default:
        break;
    }
  });
  return endStoppedCompactions(rows.filter((row) => row.kind !== "agent" || row.text.trim() !== ""));
}

/**
 * A compaction still "compacting" with the agent's reply or tool call after it did not finish: Paseo
 * sends no end for one cancelled, so its line would otherwise say "Compacting context…" for good.
 */
export function endStoppedCompactions<Row extends { kind: string; text?: string }>(rows: Row[]): Row[] {
  return rows.map((row, index) =>
    row.kind === "event" && row.text === COMPACTING && rows.slice(index + 1).some((later) => later.kind === "agent" || later.kind === "tool") ? { ...row, text: COMPACTION_STOPPED } : row,
  );
}
