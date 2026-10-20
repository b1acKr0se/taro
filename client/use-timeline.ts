import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";

import { keptMap } from "./kept";
import { addOlderPage, joinTail, withOlder, type OlderPages } from "./older-pages";
import type { TurnBoundary } from "../shared/pending-sends";
import { drawnWithPieces, MAX_PIECES, streamedPiece, turnBoundary, turnTracker, unreadPieces, withStreamed, type StreamedPiece } from "./stream-pieces";
import { CACHED_AGENTS, cacheable, createTimelineCache } from "./timeline-cache";
import type { TimelinePage, TimelineEntry } from "./transcript-rows";

/** Wait for a pause in the stream before re-reading, so one burst is one read. */
const QUIET_MS = 300;
/** A stream that never pauses is still re-read this often. */
const CEILING_MS = 1500;
/** A reply being written is drawn at most this often: about ten times a second keeps a phone smooth (TR-069). */
const DRAW_MS = 100;
/** Entries read in one earlier page as the reader scrolls up (TR-169). */
const OLDER_PAGE = 100;

export interface AgentTimeline {
  entries: TimelineEntry[];
  /**
   * The agent as of the last read. Every timeline page carries it, and a
   * permission request arrives as a stream event like any other, so this is
   * how a question the agent just asked reaches the pane without a poll.
   */
  agent: TimelinePage["agent"];
  /** Whether the daemon has entries before the ones read: the tail is `limit` long, and earlier pages are read on demand. */
  hasOlder: boolean;
  /** Reads the page before the first entry drawn (TR-169); nothing while one is read or none is left. */
  loadOlder: () => void;
  /** An earlier page is being read. */
  loadingOlder: boolean;
  /** An earlier page was asked for in this chat: from then on, rows may go in above the reader. */
  olderAsked: boolean;
  error: string | null;
  /** A read is in flight; `entries` may still hold the cached conversation meanwhile. */
  loading: boolean;
  /**
   * The last turn start or end the stream told of since the last read began (TR-201): ahead of
   * `agent`, which waits for the read it starts at once. Null once a read after it has landed.
   */
  turn: TurnBoundary | null;
}

/** The tail alone: earlier pages are kept only while the chat is open. */
type CachedRead = Pick<AgentTimeline, "entries" | "agent" | "hasOlder">;

/**
 * Outlives the chat (the host remounts the screen and the pane on every switch) and the bundle's
 * re-evaluation on reconnect (TR-038). Bump the slot's version when `CachedRead` changes shape.
 */
const cache = createTimelineCache<CachedRead>(CACHED_AGENTS, keptMap(globalThis, "timeline-cache.v1"));

/**
 * The daemon's timeline for one agent, re-read shortly after any stream event.
 *
 * Re-reading rather than appending stream deltas keeps the provider's own
 * merging — reasoning chunks and tool lifecycle updates arrive already folded
 * — so the pane never shows fragments. One read is in flight at a time; events
 * during it coalesce into a single follow-up, and the ceiling keeps a turn
 * that streams without pause from freezing the pane. The agent's last read is
 * drawn at once from the cache while the first read of a mount runs.
 *
 * The one exception is the reply's own text (TR-144): its pieces are drawn after
 * the last read as they arrive, so the reply grows as it is written, and the
 * next read takes their place (`stream-pieces.ts`).
 *
 * Earlier pages (TR-169) are read before the first entry when the chat asks, and every tail read is
 * joined to them, so a chat scrolled up keeps the whole conversation from there (`older-pages.ts`).
 */
export function useAgentTimeline(agentId: string | null, revision = "", limit = 150): AgentTimeline {
  const paseo = usePaseo();
  /** The current subscription's re-read, for the revision effect below. */
  const reread = useRef<() => void>(() => {});
  /** The current subscription's read of an earlier page. */
  const readOlder = useRef<() => void>(() => {});
  const [loadOlder] = useState(() => () => readOlder.current());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderAsked, setOlderAsked] = useState(false);
  const [initial] = useState(() => (agentId === null ? undefined : cache.get(agentId)));
  const [entries, setEntries] = useState<TimelineEntry[]>(initial?.entries ?? []);
  const [agent, setAgent] = useState<TimelinePage["agent"]>(initial?.agent ?? null);
  const [hasOlder, setHasOlder] = useState(initial?.hasOlder ?? false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(agentId !== null);
  const [turn, setTurn] = useState<TurnBoundary | null>(null);

  useEffect(() => {
    if (agentId === null) {
      setEntries([]);
      setAgent(null);
      setHasOlder(false);
      setError(null);
      setLoading(false);
      setLoadingOlder(false);
      setOlderAsked(false);
      setTurn(null);
      return;
    }
    const id = agentId;
    const timeline = paseo.agents.ref(id).timeline;
    let alive = true;
    let inFlight = false;
    let queued = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    let draw: ReturnType<typeof setTimeout> | undefined;
    /** The last read's entries and epoch, and the reply's pieces streamed since. */
    let read: readonly TimelineEntry[] = [];
    let epoch: string | null = null;
    let pieces: StreamedPiece[] = [];
    /** Earlier pages read, joined to every tail read after them; the last tail read's `hasOlder`. */
    let older: OlderPages<TimelineEntry> | null = null;
    let tailHasOlder = cache.get(id)?.hasOlder ?? false;
    let olderInFlight = false;
    const turns = turnTracker();
    // Another agent in the same mount: its cached read, or a blank pane rather than the last agent's words.
    const cached = cache.get(id);
    setEntries(cached?.entries ?? []);
    setAgent(cached?.agent ?? null);
    setHasOlder(cached?.hasOlder ?? false);
    setError(null);
    setLoading(true);
    setLoadingOlder(false);
    setOlderAsked(false);
    setTurn(null);

    function clearTimers(): void {
      clearTimeout(quiet);
      clearTimeout(ceiling);
      clearTimeout(draw);
      quiet = undefined;
      ceiling = undefined;
      draw = undefined;
    }

    function drawPieces(): void {
      draw = undefined;
      const drawn = drawnWithPieces(read, epoch, pieces);
      if (alive && drawn !== null) setEntries(withOlder(older, drawn as TimelineEntry[]) as TimelineEntry[]);
    }

    // An async function, not an async arrow: Hermes evaluates an async arrow
    // in an eval'd bundle to `undefined`.
    async function load(): Promise<void> {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      const readToken = turns.readStarted();
      try {
        const page = await timeline.refetch({ direction: "tail", limit, projection: "projected" });
        if (!alive) return;
        setTurn(turns.readLanded(readToken));
        if (cacheable(page)) cache.set(id, { entries: page.entries, agent: page.agent ?? cache.get(id)?.agent ?? null, hasOlder: page.hasOlder });
        older = joinTail(older, read, page);
        read = page.entries;
        epoch = page.epoch;
        tailHasOlder = page.hasOlder;
        pieces = unreadPieces(pieces, epoch, read);
        setEntries(withOlder(older, withStreamed(read, epoch, pieces) as TimelineEntry[]) as TimelineEntry[]);
        if (page.agent !== null) setAgent(page.agent);
        setHasOlder(older?.hasOlder ?? tailHasOlder);
        setError(page.error ?? null);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        inFlight = false;
        if (alive) {
          setLoading(false);
          if (queued) {
            queued = false;
            void load();
          }
        }
      }
    }

    /** The page before the first entry drawn, put in front of it. */
    async function loadOlderPage(): Promise<void> {
      const first = older?.entries[0] ?? read[0];
      const at = epoch;
      if (olderInFlight || at === null || first === undefined || !(older?.hasOlder ?? tailHasOlder)) return;
      olderInFlight = true;
      setLoadingOlder(true);
      setOlderAsked(true);
      // Kept from now, so entries the tail moves past while the page is read are not lost between them.
      if (older === null) older = { epoch: at, entries: [], hasOlder: tailHasOlder };
      try {
        const page = await timeline.refetch({ direction: "before", cursor: { epoch: at, seq: first.seqStart }, limit: OLDER_PAGE, projection: "projected" });
        // A tail read in the meantime may have started over (a new epoch): the page belongs to the old one.
        if (!alive || epoch !== at) return;
        older = addOlderPage(older, first, at, page);
        setEntries(withOlder(older, withStreamed(read, epoch, pieces) as TimelineEntry[]) as TimelineEntry[]);
        setHasOlder(older?.hasOlder ?? tailHasOlder);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        olderInFlight = false;
        if (alive) setLoadingOlder(false);
      }
    }

    function refresh(): void {
      clearTimers();
      void load();
    }

    function schedule(): void {
      clearTimeout(quiet);
      quiet = setTimeout(refresh, QUIET_MS);
      if (ceiling === undefined) ceiling = setTimeout(refresh, CEILING_MS);
    }

    function onEvent(event: unknown): void {
      const boundary = turnBoundary(event);
      if (boundary !== null) {
        // Drawn at once, and read at once rather than after a pause: a busy turn start held it up to the ceiling.
        turns.boundary(boundary);
        setTurn(turns.current());
        refresh();
        return;
      }
      const piece = streamedPiece(event);
      if (piece !== null) {
        if (pieces.length >= MAX_PIECES) pieces = [];
        pieces.push(piece);
        if (draw === undefined) draw = setTimeout(drawPieces, DRAW_MS);
      }
      schedule();
    }

    reread.current = schedule;
    readOlder.current = () => void loadOlderPage();
    void load();
    const unsubscribe = timeline.subscribe(onEvent);
    return () => {
      alive = false;
      clearTimers();
      unsubscribe();
    };
  }, [paseo, agentId, limit]);

  /**
   * A second way in, for whatever the stream did not say: the caller passes
   * something that changes when the agent does (the board's poll of it), and
   * a change is a re-read. A question the agent asked in the instant between
   * a read and its own tool call's last event is still seen within a poll.
   */
  useEffect(() => {
    if (revision !== "") reread.current();
  }, [revision]);

  return { entries, agent, hasOlder, loadOlder, loadingOlder, olderAsked, error, loading, turn };
}
