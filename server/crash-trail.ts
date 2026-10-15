/**
 * The host's copy of each app launch's trail and errors (TR-132), one capped file in the plugin's data
 * folder: what a phone knew before it crashed outlives it here. Errors also go to the plugin log.
 */
import { addReport, dismissLaunch, emptyTrailFile, lastCrash, TrailFileSchema, type CrashReport, type Device, type TrailFile, type TrailReport } from "../shared/crash-trail";
import { dataPath } from "./data-dir";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import { serialized } from "./serialize";

/** Reports a launch may send in a minute; the client sends one every few seconds at most, so more is a loop. */
const REPORTS_PER_MINUTE = 20;

export function crashTrailPath(): string {
  return dataPath("crash-trail.json");
}

export interface CrashTrail {
  report(report: TrailReport): Promise<void>;
  last(launch: string, device: Device): Promise<CrashReport | null>;
  dismiss(launch: string): Promise<void>;
}

export function createCrashTrail(options: { path?: string; now?: () => number; log?: (line: string) => void } = {}): CrashTrail {
  const path = options.path ?? crashTrailPath();
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.warn(line));
  const recent = new Map<string, number[]>();

  async function read(): Promise<TrailFile> {
    const parsed = TrailFileSchema.safeParse(await readJsonIfPresent(path).catch(() => null));
    // An unreadable file starts over: it only holds diagnostics.
    return parsed.success ? parsed.data : emptyTrailFile();
  }

  function allowed(launch: string): boolean {
    const since = now() - 60_000;
    const times = (recent.get(launch) ?? []).filter((time) => time > since);
    if (times.length >= REPORTS_PER_MINUTE) {
      recent.set(launch, times);
      return false;
    }
    recent.set(launch, [...times, now()]);
    if (recent.size > 50) recent.delete(recent.keys().next().value as string);
    return true;
  }

  return {
    async report(report) {
      if (!allowed(report.launch)) return;
      for (const error of report.errors) {
        log(`[taro] client error (${error.source}, ${error.where}) on ${report.device.platform} ${report.device.model}: ${error.message}`);
      }
      await serialized(path, async () => {
        await writeJsonAtomically(path, addReport(await read(), report, new Date(now()).toISOString()));
      });
    },
    async last(launch, device) {
      return lastCrash(await read(), launch, device, path);
    },
    async dismiss(launch) {
      await serialized(path, async () => {
        await writeJsonAtomically(path, dismissLaunch(await read(), launch));
      });
    },
  };
}
