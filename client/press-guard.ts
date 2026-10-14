/**
 * What every button that sends something does when pressed (TR-058): it goes busy at once and ignores
 * further presses until the call settles; then it shows a check for a moment, or, where success makes
 * the button leave (Accept, a decision's Submit), stays busy until it does; on failure it is usable
 * again. The lock is a plain variable rather than React state, so two taps inside one frame cannot both
 * get through. One guard serves a group of buttons (a card's actions): while one runs, all wait. Pure.
 */

/** How long the check stays after a call succeeds. */
export const DONE_MS = 1_500;
/**
 * The longest a button that waits to leave stays busy: should it not leave (the board has not caught up,
 * or the call did nothing visible), it comes back rather than staying stuck.
 */
export const HOLD_MS = 15_000;

/** The pressed button's look; null when the group is idle. */
export interface PressShown {
  key: string;
  phase: "busy" | "done";
}

/** After success: a check for `DONE_MS`, or busy until the button leaves (at most `HOLD_MS`). */
export type AfterSuccess = "check" | "hold";

export type PressOutcome<Value> = { ok: true; value: Value } | { ok: false; error: unknown };

export interface PressGuard {
  /** Runs `action` for the button `key`, or returns null without calling it while another press is unsettled. */
  run<Value>(key: string, action: () => Promise<Value>, after?: AfterSuccess | undefined): Promise<PressOutcome<Value>> | null;
  /** Whether a press is unsettled (busy, or holding until its button leaves). */
  locked(): boolean;
  shown(): PressShown | null;
  /** Stops the timers and the callbacks: the buttons are gone. */
  dispose(): void;
}

export interface PressGuardOptions {
  onChange?: (shown: PressShown | null) => void;
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
  doneMs?: number;
  holdMs?: number;
}

export function createPressGuard(options: PressGuardOptions = {}): PressGuard {
  const schedule = options.schedule ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const cancel = options.cancel ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const doneMs = options.doneMs ?? DONE_MS;
  const holdMs = options.holdMs ?? HOLD_MS;
  let isLocked = false;
  let current: PressShown | null = null;
  let timer: unknown = null;
  let disposed = false;

  function clearTimer(): void {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function show(next: PressShown | null): void {
    current = next;
    if (!disposed) options.onChange?.(next);
  }

  function settleLater(ms: number): void {
    timer = schedule(() => {
      timer = null;
      isLocked = false;
      show(null);
    }, ms);
  }

  return {
    run<Value>(key: string, action: () => Promise<Value>, after: AfterSuccess = "check"): Promise<PressOutcome<Value>> | null {
      if (isLocked || disposed) return null;
      isLocked = true;
      clearTimer();
      show({ key, phase: "busy" });
      // An action that throws before returning its promise fails like one that rejects.
      const started = new Promise<Value>((resolve) => resolve(action()));
      return started.then(
        (value) => {
          if (after === "hold") {
            settleLater(holdMs);
          } else {
            isLocked = false;
            show({ key, phase: "done" });
            settleLater(doneMs);
          }
          return { ok: true as const, value };
        },
        (error: unknown) => {
          isLocked = false;
          show(null);
          return { ok: false as const, error };
        },
      );
    },
    locked: () => isLocked,
    shown: () => current,
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}

export interface PressHandlers<Value> {
  after?: AfterSuccess | undefined;
  onSuccess?: (value: Value) => void;
  /** The reason, for the error toast. */
  onError: (error: unknown) => void;
}

/** A button's press: runs `action` through `guard` and reports how it went; false when the press was ignored. */
export function press<Value>(guard: PressGuard, key: string, action: () => Promise<Value>, handlers: PressHandlers<Value>): boolean {
  const running = guard.run(key, action, handlers.after);
  if (running === null) return false;
  void running.then((outcome) => {
    if (outcome.ok) handlers.onSuccess?.(outcome.value);
    else handlers.onError(outcome.error);
  });
  return true;
}
