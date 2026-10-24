/**
 * The chat composer's pick list (TR-232), live: follows the word at the box's cursor, reads the list it
 * opens (the agent's commands, the project's files or tickets) once when it opens, and picks, moves and
 * closes on the box's keys. The decisions are `client/pick-list-state.ts`; this holds the state and the calls.
 */
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";

import { applyPick, moveSelection } from "../shared/composer-picks";
import { listAgentCommands, listProjectFiles, listTicketsForPicks, readRecentCommands, rememberRecentCommand } from "../shared/contracts";
import { errorText } from "./format";
import {
  activeTrigger,
  browseTo,
  keptDismissal,
  parentFolder,
  pickKeyAction,
  pickListView,
  pickOf,
  selectedIndex,
  triggerIdentity,
  type CursorStore,
  type Loaded,
  type PickKeyEvent,
  type PickListView,
  type PickRow,
  type PickSelection,
} from "./pick-list-state";

/** A list's source read again only after this, so filtering is local while the list is open (and a little after). */
const SOURCE_FRESH_MS = 10_000;
const NO_NAMES: readonly string[] = [];

function loaded<Data, Shown>(query: UseQueryResult<Data>, shown: (data: Data) => Shown): Loaded<Shown> {
  if (query.data !== undefined) return { status: "ready", data: shown(query.data) };
  if (query.error !== null) return { status: "failed", message: errorText(query.error) };
  return { status: "loading" };
}

export interface PickListOptions {
  text: string;
  cursor: CursorStore;
  project: string;
  agentId: string;
  /** Puts the picked text in the box and the cursor at `cursor`. */
  onPick: (text: string, cursor: number) => void;
}

export interface PickList {
  view: PickListView | null;
  selected: number;
  select: (index: number) => void;
  pick: (row: PickRow) => void;
  /** The folder view's back arrow: the folder above, or the opening list from a top-level one. */
  back: () => void;
  /** The box's key, before its own Enter and Escape: true when the list took it. */
  onKey: (event: PickKeyEvent) => boolean;
}

export function usePickList({ text, cursor: cursorStore, project, agentId, onPick }: PickListOptions): PickList {
  const cursor = useSyncExternalStore(cursorStore.subscribe, cursorStore.get, cursorStore.get);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selection, setSelection] = useState<PickSelection | null>(null);
  // Read while rendering, as React allows for state that follows props: the closed word is gone.
  if (keptDismissal(text, cursor, dismissed) !== dismissed) setDismissed(null);
  const trigger = activeTrigger(text, cursor, dismissed);
  const kind = trigger?.kind ?? null;
  const queries = useQueryClient();

  const listCommands = useRpc(listAgentCommands);
  const readRecent = useRpc(readRecentCommands);
  const remember = useRpc(rememberRecentCommand);
  const listFiles = useRpc(listProjectFiles);
  const listTickets = useRpc(listTicketsForPicks);
  const recentKey = ["taro", "composer-recent", project] as const;
  // Read once when a list opens; the key leaves out what is typed, so each keystroke filters what was read.
  const shared = {
    staleTime: SOURCE_FRESH_MS,
    refetchOnWindowFocus: false,
    retry: false,
  } as const;
  const commands = useQuery({
    queryKey: ["taro", "composer-commands", agentId],
    queryFn: () => listCommands({ agentId }),
    enabled: kind === "command",
    ...shared,
  });
  const recent = useQuery({
    queryKey: recentKey,
    queryFn: () => readRecent({ project }),
    enabled: kind === "command",
    ...shared,
  });
  const files = useQuery({
    queryKey: ["taro", "composer-files", project, agentId],
    queryFn: () => listFiles({ project, agentId }),
    enabled: kind === "file",
    ...shared,
  });
  const tickets = useQuery({
    queryKey: ["taro", "composer-tickets", project],
    queryFn: () => listTickets({ project }),
    enabled: kind === "ticket",
    ...shared,
  });

  const view = pickListView(trigger, {
    commands: loaded(commands, (data) => data),
    recent: recent.data?.names ?? NO_NAMES,
    files: loaded(files, (data) => data),
    tickets: loaded(tickets, (data) => data.tickets),
  });
  const rows = view?.rows ?? [];
  const selected = view === null ? 0 : selectedIndex(selection, view.trigger.kind, view.trigger.query, rows.length);

  function select(index: number): void {
    if (view !== null)
      setSelection({
        kind: view.trigger.kind,
        query: view.trigger.query,
        index,
      });
  }

  function place(next: { text: string; cursor: number }): void {
    onPick(next.text, next.cursor);
    // The box reports its cursor too, but later than the list wants to follow the new word.
    cursorStore.set(next.cursor);
  }

  function pick(row: PickRow): void {
    if (view === null) return;
    const chosen = pickOf(row);
    place(applyPick(text, view.trigger, chosen));
    if (chosen.kind !== "command") return;
    remember({ project, name: chosen.name })
      .then((answer) => queries.setQueryData(recentKey, answer))
      .catch(() => undefined);
  }

  function back(): void {
    if (view === null || view.folder === null) return;
    place(browseTo(text, view.trigger, parentFolder(view.folder)));
  }

  function onKey(event: PickKeyEvent): boolean {
    const action = pickKeyAction(event, {
      shown: view !== null,
      rows: rows.length,
    });
    if (action === null || view === null) return false;
    if (action === "close") setDismissed(triggerIdentity(text, view.trigger));
    else if (action === "up" || action === "down") select(moveSelection(selected, rows.length, action));
    else {
      const row = rows[selected];
      if (row !== undefined) pick(row);
    }
    return true;
  }

  return { view, selected, select, pick, back, onKey };
}
