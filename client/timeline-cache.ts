/**
 * The last read of each agent's timeline, kept for the screen's lifetime (TR-018). Switching chat,
 * agent or tab remounts the chat; drawing what was read last time at once, and re-reading behind a
 * loading bar, keeps the pane from blanking on every switch.
 */

/** Enough for a project's manager, its open owners and their subagents. */
export const CACHED_AGENTS = 24;

export class TimelineCache<Value> {
  private readonly values = new Map<string, Value>();

  constructor(private readonly capacity: number = CACHED_AGENTS) {}

  get(agentId: string): Value | undefined {
    const value = this.values.get(agentId);
    if (value === undefined) return undefined;
    // Read means recently used: move it to the end, the side eviction spares.
    this.values.delete(agentId);
    this.values.set(agentId, value);
    return value;
  }

  set(agentId: string, value: Value): void {
    this.values.delete(agentId);
    this.values.set(agentId, value);
    while (this.values.size > this.capacity) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }

  get size(): number {
    return this.values.size;
  }
}

/** Whether a timeline read may replace the cached one: a failed read's empty page must not blank a good conversation. */
export function cacheable(read: { error?: string | null | undefined }): boolean {
  return read.error === undefined || read.error === null || read.error === "";
}
