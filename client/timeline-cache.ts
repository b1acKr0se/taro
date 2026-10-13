/**
 * The last read of each agent's timeline, kept for the screen's lifetime (TR-018). Switching chat,
 * agent or tab remounts the chat; drawing what was read last time at once, and re-reading behind a
 * loading bar, keeps the pane from blanking on every switch.
 */

/** Enough for a project's manager, its open owners and their subagents. */
export const CACHED_AGENTS = 24;

export interface TimelineCache<Value> {
  get(agentId: string): Value | undefined;
  set(agentId: string, value: Value): void;
  size(): number;
}

/**
 * A closure, not a class: the plugin's client bundle bypasses Metro, and Hermes on the phone fails
 * the whole plugin at load on class syntax (TR-023).
 */
export function createTimelineCache<Value>(capacity: number = CACHED_AGENTS): TimelineCache<Value> {
  const values = new Map<string, Value>();
  return {
    get(agentId) {
      const value = values.get(agentId);
      if (value === undefined) return undefined;
      // Read means recently used: move it to the end, the side eviction spares.
      values.delete(agentId);
      values.set(agentId, value);
      return value;
    },
    set(agentId, value) {
      values.delete(agentId);
      values.set(agentId, value);
      while (values.size > capacity) {
        const oldest = values.keys().next().value;
        if (oldest === undefined) break;
        values.delete(oldest);
      }
    },
    size() {
      return values.size;
    },
  };
}

/** Whether a timeline read may replace the cached one: a failed read's empty page must not blank a good conversation. */
export function cacheable(read: { error?: string | null | undefined }): boolean {
  return read.error === undefined || read.error === null || read.error === "";
}
