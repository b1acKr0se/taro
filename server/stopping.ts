/**
 * The plugin's stop (TR-067). Paseo disposes the plugin's API before Taro's cleanup runs and
 * disconnects the IPC channel after it, so work still in flight at a reload or stop fails on the
 * disposed API, or answers an RPC into the closed channel. Those failures are the stop's, not real
 * ones; logged, they hid real errors in `paseo plugin logs taro`. Once stopping, they are not logged.
 */

interface ProcessEvents {
  on(event: "error", listener: (error: Error) => void): unknown;
}

let stopping = false;

/**
 * Marks the plugin stopping, first thing in its cleanup. Also listens for the closed IPC channel: an
 * RPC handler that ends after Paseo disconnected answers with `process.send`, which then emits
 * `error` on the process, and with no listener Node prints it as unhandled. Only from the stop on:
 * before it, an orphaned plugin (the daemon gone) should still crash rather than linger.
 */
export function markStopping(target: ProcessEvents = process): void {
  if (stopping) return;
  stopping = true;
  target.on("error", (error) => {
    if ((error as NodeJS.ErrnoException).code === "ERR_IPC_CHANNEL_CLOSED") return;
    console.error("[taro] plugin process error while stopping:", error);
  });
}

export function isStopping(): boolean {
  return stopping;
}

/** Logs a failure at error level, unless the plugin is stopping (then the stop caused it). */
export function reportFailure(message: string, error: unknown): void {
  if (!stopping) console.error(message, error);
}

/** For tests: back to running. */
export function resetStopping(): void {
  stopping = false;
}
