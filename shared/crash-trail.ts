/**
 * Crash tracing (TR-132): the client's errors and a short trail of what it showed and did, kept on the
 * host per app launch, so the launch after a crash can say what happened. A step names a screen, a
 * button's key or an app event, never what anybody wrote; free text is cut down to a fixed alphabet
 * on both sides of the wire.
 */
import { z } from "zod";

/** Steps kept per launch, errors kept per launch, launches kept in the file. */
export const TRAIL_STEPS = 60;
export const TRAIL_ERRORS = 5;
export const TRAIL_LAUNCHES = 20;
/** Steps a crash report shows. */
export const REPORT_STEPS = 8;
const WHAT_LENGTH = 80;
const MESSAGE_LENGTH = 300;
const STACK_LENGTH = 4_000;

export const STEP_KINDS = ["launch", "screen", "press", "keyboard", "app"] as const;
export const ERROR_SOURCES = ["boundary", "fatal", "error", "rejection"] as const;
/** Platforms where an app process that ends in the foreground has crashed: a phone app is sent to the background before it is closed. */
const PHONE_PLATFORMS = new Set(["ios", "android"]);

export const TrailStepSchema = z.object({
  at: z.string().max(40),
  kind: z.enum(STEP_KINDS),
  what: z.string().max(WHAT_LENGTH),
});
export type TrailStep = z.infer<typeof TrailStepSchema>;

export const TrailErrorSchema = z.object({
  at: z.string().max(40),
  source: z.enum(ERROR_SOURCES),
  /** The surface that failed (a boundary's label) or "app" for the app's own handlers. */
  where: z.string().max(WHAT_LENGTH),
  message: z.string().max(MESSAGE_LENGTH),
  stack: z.string().max(STACK_LENGTH),
});
export type TrailError = z.infer<typeof TrailErrorSchema>;

export const DeviceSchema = z.object({
  /** `Platform.OS`: ios, android, web. */
  platform: z.string().max(20),
  os: z.string().max(40),
  /** The phone's model where the platform says it (Android), else its kind (phone, pad, desktop, browser). */
  model: z.string().max(60),
  /** The window in points, e.g. 390×844. */
  window: z.string().max(20),
});
export type Device = z.infer<typeof DeviceSchema>;

export const LaunchIdSchema = z.string().regex(/^[a-z0-9]{8,32}$/);
export const AppStateSchema = z.enum(["foreground", "background"]);
export type AppStateName = z.infer<typeof AppStateSchema>;

export const TrailReportSchema = z.object({
  launch: LaunchIdSchema,
  device: DeviceSchema,
  state: AppStateSchema,
  steps: z.array(TrailStepSchema).max(TRAIL_STEPS),
  errors: z.array(TrailErrorSchema).max(TRAIL_ERRORS),
});
export type TrailReport = z.infer<typeof TrailReportSchema>;

export const LaunchRecordSchema = z.object({
  launch: LaunchIdSchema,
  device: DeviceSchema,
  startedAt: z.string(),
  lastAt: z.string(),
  state: AppStateSchema,
  steps: z.array(TrailStepSchema),
  errors: z.array(TrailErrorSchema),
  /** The user dismissed the report of this launch's crash. */
  dismissed: z.boolean().default(false),
});
export type LaunchRecord = z.infer<typeof LaunchRecordSchema>;

export const TrailFileSchema = z.object({ version: z.literal(1), launches: z.array(LaunchRecordSchema) });
export type TrailFile = z.infer<typeof TrailFileSchema>;

export const CrashReportSchema = z.object({
  launch: LaunchIdSchema,
  device: DeviceSchema,
  /** When the crashed launch was last heard from, or its first error. */
  at: z.string(),
  cause: z.enum(["error", "stopped"]),
  error: TrailErrorSchema.nullable(),
  steps: z.array(TrailStepSchema),
  /** Where the host keeps the whole trail. */
  file: z.string(),
});
export type CrashReport = z.infer<typeof CrashReportSchema>;

/** Text cut to letters, digits and a few separators: ids, keys and view names pass, a sentence loses its punctuation and length. */
export function plainWhat(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9 ._:#/+×-]/g, "")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, WHAT_LENGTH);
}

/** A button's key as a step: a key that is a word stays, anything else (an option's label) is only "option". */
export function pressWhat(key: string): string {
  return /^[a-z][a-z0-9-]{0,40}$/.test(key) ? key : "option";
}

export function trailError(source: TrailError["source"], where: string, error: unknown, at: string): TrailError {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
  return { at, source, where: plainWhat(where), message: message.slice(0, MESSAGE_LENGTH), stack: stack.slice(0, STACK_LENGTH) };
}

export function deviceKey(device: Device): string {
  return `${device.platform}|${device.model}`;
}

export function emptyTrailFile(): TrailFile {
  return { version: 1, launches: [] };
}

/** The file with one report added: its launch's steps and errors appended and capped, the oldest launches dropped. */
export function addReport(file: TrailFile, report: TrailReport, now: string): TrailFile {
  const steps = report.steps.map((step) => ({ ...step, what: plainWhat(step.what) }));
  const errors = report.errors.map((error) => ({ ...error, where: plainWhat(error.where) }));
  const existing = file.launches.find((launch) => launch.launch === report.launch);
  const record: LaunchRecord =
    existing === undefined
      ? { launch: report.launch, device: report.device, startedAt: now, lastAt: now, state: report.state, steps: [], errors: [], dismissed: false }
      : existing;
  const updated: LaunchRecord = {
    ...record,
    device: report.device,
    lastAt: now,
    state: report.state,
    steps: [...record.steps, ...steps].slice(-TRAIL_STEPS),
    // The first errors explain a crash; later ones are often its echoes.
    errors: [...record.errors, ...errors].slice(0, TRAIL_ERRORS),
  };
  const others = file.launches.filter((launch) => launch.launch !== report.launch);
  const launches = [...others, updated].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(-TRAIL_LAUNCHES);
  return { version: 1, launches };
}

/** How a launch ended, judged after it: a recorded error, or a phone app that stopped while open. Null when it ended normally. */
export function crashCause(launch: LaunchRecord): CrashReport["cause"] | null {
  if (launch.errors.length > 0) return "error";
  if (PHONE_PLATFORMS.has(launch.device.platform) && launch.state === "foreground") return "stopped";
  return null;
}

/** The newest crash of an earlier launch on the same device that the user has not dismissed, or null. */
export function lastCrash(file: TrailFile, current: string, device: Device, path: string): CrashReport | null {
  const key = deviceKey(device);
  const earlier = file.launches.filter((launch) => launch.launch !== current && deviceKey(launch.device) === key);
  for (const launch of [...earlier].reverse()) {
    if (launch.dismissed) continue;
    const cause = crashCause(launch);
    if (cause === null) continue;
    const error = launch.errors[0] ?? null;
    return {
      launch: launch.launch,
      device: launch.device,
      at: error?.at ?? launch.lastAt,
      cause,
      error,
      steps: launch.steps.slice(-REPORT_STEPS),
      file: path,
    };
  }
  return null;
}

export function dismissLaunch(file: TrailFile, launch: string): TrailFile {
  return { ...file, launches: file.launches.map((record) => (record.launch === launch ? { ...record, dismissed: true } : record)) };
}

/** The device in one line: "android 14 · Pixel 8 · 412×915". */
export function deviceLine(device: Device): string {
  return [device.os === "" ? device.platform : `${device.platform} ${device.os}`, device.model, device.window].filter((part) => part !== "").join(" · ");
}
