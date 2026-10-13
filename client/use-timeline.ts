import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";

import { TimelineCache } from "./timeline-cache";
import type { TimelinePage, TimelineEntry } from "./transcript-rows";

/** Wait for a pause in the stream before re-reading, so one burst is one read. */
const QUIET_MS = 300;
/** A stream that never pauses is still re-read this often. */
const CEILING_MS = 1500;

export interface AgentTimeline {
  entries: TimelineEntry[];
  /**
   * The agent as of the last read. Every timeline page carries it, and a
   * permission request arrives as a stream event like any other, so this is
   * how a question the agent just asked reaches the pane without a poll.
   */
  agent: TimelinePage["agent"];
  /** Whether the daemon has entries before the ones read — the tail is `limit` long. */
  hasOlder: boolean;
  error: string | null;
  /** A read is in flight; `entries` may still hold the cached conversation meanwhile. */
  loading: boolean;
}

type CachedRead = Pick<AgentTimeline, "entries" | "agent" | "hasOlder">;

/** Module-wide, so it outlives the chat: the host remounts the screen and the pane on every switch. */
const cache = new TimelineCache<CachedRead>();

/**
 * The daemon's timeline for one agent, re-read shortly after any stream event.
 *
 * Re-reading rather than appending stream deltas keeps the provider's own
 * merging — reasoning chunks and tool lifecycle updates arrive already folded
 * — so the pane never shows fragments. One read is in flight at a time; events
 * during it coalesce into a single follow-up, and the ceiling keeps a turn
 * that streams without pause from freezing the pane. The agent's last read is
 * drawn at once from the cache while the first read of a mount runs.
 */
export function useAgentTimeline(agentId: string | null, revision = "", limit = 150): AgentTimeline {
  const paseo = usePaseo();
  /** The current subscription's re-read, for the revision effect below. */
  const reread = useRef<() => void>(() => {});
  const [initial] = useState(() => (agentId === null ? undefined : cache.get(agentId)));
  const [entries, setEntries] = useState<TimelineEntry[]>(initial?.entries ?? []);
  const [agent, setAgent] = useState<TimelinePage["agent"]>(initial?.agent ?? null);
  const [hasOlder, setHasOlder] = useState(initial?.hasOlder ?? false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(agentId !== null);

  useEffect(() => {
    if (agentId === null) {
      setEntries([]);
      setAgent(null);
      setHasOlder(false);
      setError(null);
      setLoading(false);
      return;
    }
    const id = agentId;
    const timeline = paseo.agents.ref(id).timeline;
    let alive = true;
    let inFlight = false;
    let queued = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    // Another agent in the same mount: its cached read, or a blank pane rather than the last agent's words.
    const cached = cache.get(id);
    setEntries(cached?.entries ?? []);
    setAgent(cached?.agent ?? null);
    setHasOlder(cached?.hasOlder ?? false);
    setError(null);
    setLoading(true);

    function clearTimers(): void {
      clearTimeout(quiet);
      clearTimeout(ceiling);
      quiet = undefined;
      ceiling = undefined;
    }

    // An async function, not an async arrow: Hermes evaluates an async arrow
    // in an eval'd bundle to `undefined`.
    async function load(): Promise<void> {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      try {
        const page = await timeline.refetch({ direction: "tail", limit, projection: "projected" });
        if (!alive) return;
        cache.set(id, { entries: page.entries, agent: page.agent ?? cache.get(id)?.agent ?? null, hasOlder: page.hasOlder });
        setEntries(page.entries);
        if (page.agent !== null) setAgent(page.agent);
        setHasOlder(page.hasOlder);
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

    function refresh(): void {
      clearTimers();
      void load();
    }

    function schedule(): void {
      clearTimeout(quiet);
      quiet = setTimeout(refresh, QUIET_MS);
      if (ceiling === undefined) ceiling = setTimeout(refresh, CEILING_MS);
    }

    reread.current = schedule;
    void load();
    const unsubscribe = timeline.subscribe(schedule);
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

  return { entries, agent, hasOlder, error, loading };
}
