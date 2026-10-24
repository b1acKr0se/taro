/**
 * The chat composer's pick list (TR-232), as data: which list the word at the cursor opens, its rows or
 * the line shown instead, the selected row as the rows change, what a key does, and the pieces a row
 * draws. Ranking and inserting are `shared/composer-picks.ts`; this decides around them. Pure, for vitest.
 */
import {
  findActiveTrigger,
  pickListKey,
  rankCommands,
  rankFiles,
  rankTickets,
  type ActiveTrigger,
  type AgentCommand,
  type CommandRow,
  type FileIndex,
  type FileRow,
  type Pick,
  type PickKind,
  type PickListKey,
  type TicketRow,
  type TicketSummary,
} from "../shared/composer-picks";

/** One list's source as the list sees it: still loading, failed with a sentence, or read. */
export type Loaded<Data> = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; data: Data };

export interface PickSources {
  commands: Loaded<{ commands: readonly AgentCommand[]; error: string | null }>;
  /** The project's recently picked command names, latest first. */
  recent: readonly string[];
  files: Loaded<FileIndex>;
  tickets: Loaded<readonly TicketSummary[]>;
}

export type PickRow =
  { kind: "command"; key: string; row: CommandRow } | { kind: "file"; key: string; row: FileRow } | { kind: "ticket"; key: string; row: TicketRow };

/** The line drawn in place of rows; `detail` is a provider's own words under it. */
export interface PickMessage {
  text: string;
  detail: string | null;
}

export interface PickListView {
  trigger: ActiveTrigger;
  rows: PickRow[];
  /** Null when there are rows. */
  message: PickMessage | null;
  /** The folder being browsed (`client/`) and how many files it holds, or null. */
  folder: string | null;
  fileCount: number | null;
}

const LOADING_TEXT: Record<PickKind, string> = {
  command: "Loading commands…",
  file: "Looking for files…",
  ticket: "Loading tickets…",
};
const NO_MATCH_TEXT: Record<PickKind, string> = {
  command: "No matching commands",
  file: "No matching files",
  ticket: "No matching tickets",
};
export const NO_COMMANDS_TEXT = "This agent lists no commands";
const FAILED_FALLBACK = "The list could not be read";

/** Who the word at the cursor is, so a list closed with Escape stays closed until the word changes. */
export function triggerIdentity(text: string, trigger: ActiveTrigger): string {
  return `${trigger.kind}:${trigger.start}:${text.slice(trigger.start, trigger.end)}`;
}

/** The trigger the list follows: none while text is selected, or once Escape closed this very word. */
export function activeTrigger(text: string, cursor: number | null, dismissed: string | null): ActiveTrigger | null {
  if (cursor === null) return null;
  const trigger = findActiveTrigger(text, cursor);
  if (trigger === null || (dismissed !== null && triggerIdentity(text, trigger) === dismissed)) return null;
  return trigger;
}

/** The word Escape closed, kept while the cursor stays in it; forgotten once it changes, so typing it again opens the list. */
export function keptDismissal(text: string, cursor: number | null, dismissed: string | null): string | null {
  if (dismissed === null || cursor === null) return dismissed;
  const trigger = findActiveTrigger(text, cursor);
  return trigger !== null && triggerIdentity(text, trigger) === dismissed ? dismissed : null;
}

function sourceMessage(kind: PickKind, source: Loaded<unknown>): PickMessage | null {
  if (source.status === "loading") return { text: LOADING_TEXT[kind], detail: null };
  if (source.status === "failed")
    return {
      text: source.message.trim() === "" ? FAILED_FALLBACK : source.message,
      detail: null,
    };
  return null;
}

/**
 * What the list shows for `trigger`, or null when it is not drawn: a `/` after other words opens only
 * once something typed after it matches a command, so a slash in a sentence never pops a list up.
 */
/**
 * Whether the list takes the box's keys (TR-232): only on the web. A phone's Return cannot be held back,
 * so it would both pick and type a new line; there a tap picks.
 */
export function listTakesKeys(platform: string): boolean {
  return platform === "web";
}

export function pickListView(trigger: ActiveTrigger | null, sources: PickSources): PickListView | null {
  if (trigger === null) return null;
  const kind = trigger.kind;
  const quiet = kind === "command" && !trigger.atStart;
  if (quiet && trigger.query === "") return null;
  const source = kind === "command" ? sources.commands : kind === "file" ? sources.files : sources.tickets;
  const waiting = sourceMessage(kind, source);
  if (waiting !== null) return quiet ? null : { trigger, rows: [], message: waiting, folder: null, fileCount: null };
  let rows: PickRow[] = [];
  let folder: string | null = null;
  let fileCount: number | null = null;
  let message: PickMessage | null = null;
  if (kind === "command" && sources.commands.status === "ready") {
    const { commands, error } = sources.commands.data;
    if (commands.length === 0)
      message = {
        text: NO_COMMANDS_TEXT,
        detail: error === null || error.trim() === "" ? null : error,
      };
    rows = rankCommands(commands, trigger.query, sources.recent, !trigger.atStart).map((row): PickRow => ({
      kind: "command",
      key: `command:${row.command.name}`,
      row,
    }));
  } else if (kind === "file" && sources.files.status === "ready") {
    const list = rankFiles(sources.files.data, trigger.query);
    rows = list.rows.map((row): PickRow => ({
      kind: "file",
      key: `${row.kind}:${row.path}`,
      row,
    }));
    folder = list.folder;
    fileCount = list.fileCount;
  } else if (kind === "ticket" && sources.tickets.status === "ready") {
    rows = rankTickets(sources.tickets.data, trigger.query).map((row): PickRow => ({
      kind: "ticket",
      key: `ticket:${row.ticket.id}`,
      row,
    }));
  }
  if (rows.length === 0 && quiet) return null;
  if (rows.length === 0 && message === null) message = { text: NO_MATCH_TEXT[kind], detail: null };
  return {
    trigger,
    rows,
    message: rows.length === 0 ? message : null,
    folder,
    fileCount,
  };
}

/** The selected row and the list it was chosen in. */
export interface PickSelection {
  kind: PickKind;
  query: string;
  index: number;
}

/** The selected row once the rows change: the first again for a new query or list, the same one otherwise, kept within the rows. */
export function selectedIndex(previous: PickSelection | null, kind: PickKind, query: string, count: number): number {
  if (count <= 0 || previous === null || previous.kind !== kind || previous.query !== query) return 0;
  return Math.max(0, Math.min(previous.index, count - 1));
}

/** The keys the list reads: React Native Web's key event, which also carries the DOM's Shift and composition. */
export interface PickKeyEvent {
  key: string;
  shiftKey?: boolean | undefined;
  isComposing?: boolean | undefined;
  keyCode?: number | undefined;
}

/**
 * What a key does to the list, or null to leave it to the box (Enter sends, Escape stops the agent).
 * Escape closes any list drawn; moving and picking need rows. An input method confirming a word is the box's.
 */
export function pickKeyAction(event: PickKeyEvent, list: { shown: boolean; rows: number }): PickListKey | null {
  if (!list.shown || event.isComposing === true || event.keyCode === 229) return null;
  const action = pickListKey(event.key, event.shiftKey === true);
  if (action === null || action === "close") return action;
  return list.rows > 0 ? action : null;
}

/** What picking a row puts in the box. */
export function pickOf(row: PickRow): Pick {
  if (row.kind === "command") return { kind: "command", name: row.row.command.name };
  if (row.kind === "ticket") return { kind: "ticket", id: row.row.ticket.id };
  return row.row.kind === "folder" ? { kind: "folder", path: row.row.path } : { kind: "file", path: row.row.path };
}

/** The folder above `folder` (`client/sub/` → `client/`), or "" from a top-level one. */
export function parentFolder(folder: string): string {
  const slash = folder.lastIndexOf("/", folder.length - 2);
  return slash === -1 ? "" : folder.slice(0, slash + 1);
}

/** The text with the `@` word set to `@` and `folder`, and the cursor after it: the folder view's back arrow. */
export function browseTo(text: string, trigger: ActiveTrigger, folder: string): { text: string; cursor: number } {
  const word = `@${folder}`;
  return {
    text: text.slice(0, trigger.start) + word + text.slice(trigger.end),
    cursor: trigger.start + word.length,
  };
}

/** A piece of a row's name, `marked` where it matched what was typed. */
export interface MarkedPiece {
  text: string;
  marked: boolean;
}

/** `text` cut into marked and plain runs; `hits` index the whole string `text` starts `offset` into. */
export function markedPieces(text: string, hits: readonly number[], offset = 0): MarkedPiece[] {
  const marked = new Set(hits.map((hit) => hit - offset));
  const pieces: MarkedPiece[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const isMarked = marked.has(index);
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.marked === isMarked) last.text += text.charAt(index);
    else pieces.push({ text: text.charAt(index), marked: isMarked });
  }
  return pieces;
}

/** A file row's name (a folder's keeps its slash) and the folder it is in, each with its matched letters. */
export function fileRowParts(row: FileRow, browsing: boolean): { name: MarkedPiece[]; folder: MarkedPiece[] } {
  const searchFrom = row.kind === "folder" ? row.path.length - 2 : row.path.length - 1;
  const nameStart = row.path.lastIndexOf("/", searchFrom) + 1;
  return {
    name: markedPieces(row.path.slice(nameStart), row.hits, nameStart),
    folder: browsing || nameStart === 0 ? [] : markedPieces(row.path.slice(0, nameStart), row.hits),
  };
}

export interface PickHeading {
  text: string;
  icon: string | null;
}

const HEADINGS: Record<string, PickHeading> = {
  "command:recent": { text: "Used recently here", icon: "Clock" },
  "command:all": { text: "All commands and skills", icon: null },
  "file:changed": { text: "Changed on this branch", icon: "GitBranch" },
  "file:recent": { text: "Edited recently", icon: "Clock" },
  "file:top": { text: "Top level", icon: "FolderOpen" },
};

function sectionOf(row: PickRow): string | null {
  return row.kind === "ticket" || row.row.section === null ? null : `${row.kind}:${row.row.section}`;
}

/**
 * The heading over row `index`, where a section starts. The list's catch-all section (all commands, the
 * top level) is headed only below another one: alone, it is simply the list.
 */
export function headingBefore(rows: readonly PickRow[], index: number): PickHeading | null {
  const row = rows[index];
  if (row === undefined) return null;
  const section = sectionOf(row);
  if (section === null) return null;
  const previous = rows[index - 1];
  if (previous !== undefined && sectionOf(previous) === section) return null;
  if ((section === "command:all" || section === "file:top") && index === 0) return null;
  return HEADINGS[section] ?? null;
}

const UNDER_WAY = ["in progress", "reviewing"];

/** The tone of a ticket's status tag: done in green, being built or reviewed in amber, blocked in red, the rest plain. */
export function ticketStatusTone(status: string): "success" | "warning" | "danger" | "muted" {
  const lower = status.toLowerCase();
  if (lower === "done") return "success";
  if (UNDER_WAY.includes(lower)) return "warning";
  if (lower === "blocked") return "danger";
  return "muted";
}

/** Where the list scrolls to keep the selected row in view: no move while it shows already. */
export function scrollToShow(current: number, viewport: number, rowTop: number, rowHeight: number): number {
  if (viewport <= 0) return current;
  if (rowTop < current) return rowTop;
  if (rowTop + rowHeight > current + viewport) return rowTop + rowHeight - viewport;
  return current;
}

/**
 * The cursor the box reports, shared between the box and the list without redrawing the chat on each
 * move: null while text is selected. The list subscribes; the box sets it on every selection change.
 */
export interface CursorStore {
  get(): number | null;
  set(cursor: number | null): void;
  subscribe(listener: () => void): () => void;
}

export function createCursorStore(): CursorStore {
  let cursor: number | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => cursor,
    set(next) {
      if (next === cursor) return;
      cursor = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
