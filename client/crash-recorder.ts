/**
 * The client half of crash tracing (TR-132), without React Native so it can be tested: steps and
 * errors wait in a kept slot (`kept.ts`) until a mounted Taro component lends its RPC, then go to the
 * host in batches, at most one every few seconds; an error or the app leaving the foreground sends
 * at once, as the app may not live to send it later. The slot outlives a reconnect's re-evaluation
 * but not the app process, so a fresh slot is a fresh launch.
 */
import { plainWhat, trailError, TRAIL_ERRORS, TRAIL_STEPS, type AppStateName, type TrailError, type TrailReport, type TrailStep } from "../shared/crash-trail";
import { keptObject } from "./kept";

/** The pause between batches of steps. */
export const SEND_EVERY_MS = 5_000;

export type TrailSend = (report: Omit<TrailReport, "device">) => Promise<void>;

export interface CrashRecorder {
  /** This app launch's id. */
  readonly launch: string;
  /** The slot was made by this evaluation: the app process has just started. */
  readonly fresh: boolean;
  step(kind: TrailStep["kind"], what: string): void;
  error(source: TrailError["source"], where: string, error: unknown): void;
  setState(state: AppStateName): void;
  setSender(send: TrailSend): void;
  /** Drops `send` if it is still the one sending (an unmounted component's). */
  clearSender(send: TrailSend): void;
  flush(): Promise<void>;
}

export interface RecorderOptions {
  root?: object;
  now?: () => number;
  schedule?: (run: () => void, ms: number) => void;
  random?: () => number;
}

function newLaunchId(now: number, random: () => number): string {
  const part = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `${now.toString(36)}${part}`.slice(0, 32);
}

export function createCrashRecorder(options: RecorderOptions = {}): CrashRecorder {
  const root = options.root ?? globalThis;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((run: () => void, ms: number) => void setTimeout(run, ms));
  const kept = keptObject(root, "crash-trail-1", {
    launch: "",
    state: "foreground" as AppStateName,
    steps: [] as TrailStep[],
    errors: [] as TrailError[],
    send: null as TrailSend | null,
    sendingSince: 0,
    scheduled: false,
  });
  const fresh = kept.launch === "";
  if (fresh) kept.launch = newLaunchId(now(), options.random ?? Math.random);

  function at(): string {
    return new Date(now()).toISOString();
  }

  function later(): void {
    if (kept.scheduled) return;
    kept.scheduled = true;
    schedule(() => {
      kept.scheduled = false;
      void flush();
    }, SEND_EVERY_MS);
  }

  async function flush(): Promise<void> {
    const send = kept.send;
    // A send the old evaluation started before a reconnect may never settle; past a minute it no longer blocks.
    if (send === null || (kept.sendingSince !== 0 && now() - kept.sendingSince < 60_000)) return;
    if (kept.steps.length === 0 && kept.errors.length === 0) return;
    const steps = kept.steps.slice(0, TRAIL_STEPS);
    const errors = kept.errors.slice(0, TRAIL_ERRORS);
    kept.sendingSince = now();
    try {
      await send({ launch: kept.launch, state: kept.state, steps, errors });
      // Only what was sent leaves: steps added meanwhile may have pushed some of it out already.
      const sentSteps = new Set(steps);
      const sentErrors = new Set(errors);
      kept.steps = kept.steps.filter((step) => !sentSteps.has(step));
      kept.errors = kept.errors.filter((error) => !sentErrors.has(error));
    } catch {
      // Kept for the next try; the host may be reconnecting.
    } finally {
      kept.sendingSince = 0;
    }
    if (kept.steps.length > 0 || kept.errors.length > 0) later();
  }

  return {
    launch: kept.launch,
    fresh,
    step(kind, what) {
      kept.steps = [...kept.steps, { at: at(), kind, what: plainWhat(what) }].slice(-TRAIL_STEPS);
      later();
    },
    error(source, where, error) {
      // The first errors explain a crash; later ones are often its echoes.
      if (kept.errors.length < TRAIL_ERRORS) kept.errors = [...kept.errors, trailError(source, where, error, at())];
      void flush();
    },
    setState(state) {
      kept.state = state;
      if (state === "background") void flush();
    },
    setSender(send) {
      kept.send = send;
      void flush();
    },
    clearSender(send) {
      if (kept.send === send) kept.send = null;
    },
    flush,
  };
}

/** A web page's error event that is a failure: one with an error object, not a browser warning such as ResizeObserver's loop notice. */
export function isPageFailure(event: { error?: unknown; message?: unknown }): boolean {
  if (event.error === undefined || event.error === null) return false;
  const message = typeof event.message === "string" ? event.message : event.error instanceof Error ? event.error.message : "";
  return !/ResizeObserver loop/.test(message);
}

let shared: CrashRecorder | null = null;

/** The recorder of this evaluation of the bundle, made on first use. */
export function crashRecorder(): CrashRecorder {
  if (shared === null) shared = createCrashRecorder();
  return shared;
}
