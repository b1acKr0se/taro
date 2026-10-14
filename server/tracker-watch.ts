/**
 * The plugin is the tracker's only committer (decision 31): each project's
 * `tracker/tickets/` and `tracker.json` are watched (never `.taro/` or a temp
 * file), each event drops that ticket's cached summary, and changes are
 * committed a few seconds after the last write; a pass that finds a write
 * holding the tracker lock tries again after another few seconds. With remote sync on, each commit is pushed after a
 * pull; a failure is kept and shown until a later commit syncs or the user
 * resolves it. A failed sync is not retried on file changes alone: the
 * plugin's own rebase and abort rewrite the tracker's files, which would
 * otherwise pull again every few seconds. Board reads also pull, at most once
 * a minute, so tickets edited on another machine show up; a conflict pauses
 * that until the user resolves it. A backstop (TR-050) catches a missed
 * file-watch event: a project whose listeners have not run for five minutes is
 * committed and passed again when its tracker has uncommitted changes or a HEAD
 * they have not seen.
 */
import { watch, type FSWatcher } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { listProjectConfigs, projectPaths } from "./projects";
import { serialized } from "./serialize";
import type { SyncResolution, TrackerSyncProblem } from "../shared/contracts";
import { runChecked, runCommand } from "./process";
import { forgetTicketFile } from "./tickets";
import { commitTracker, syncTracker, trackerPathspecs, type SyncStrategy } from "./tracker";

const DEBOUNCE_MS = 5_000;
const PULL_INTERVAL_MS = 60_000;
export const BACKSTOP_INTERVAL_MS = 5 * 60_000;

export type TrackerChangeListener = (project: string) => void;
export type TrackerSyncer = (trackerPath: string, strategy?: SyncStrategy) => Promise<TrackerSyncProblem | null>;

/** Whether a file event under `tickets/` is a ticket's: the store's temp files and other dot files are not. */
export function isTicketFileEvent(name: string): boolean {
  return name.endsWith(".md") && !name.startsWith(".") && !name.includes("/") && !name.includes("\\");
}

const RESOLUTION_STRATEGIES: Readonly<Record<SyncResolution, SyncStrategy>> = {
  "keep-local": "keep-local",
  "keep-remote": "keep-remote",
  retry: "rebase",
};

interface Watched {
  watchers: FSWatcher[];
  timer: NodeJS.Timeout | null;
}

export class TrackerWatch {
  private readonly watched = new Map<string, Watched>();
  private readonly syncProblems = new Map<string, TrackerSyncProblem>();
  /** When each project last finished a sync (any kind), or claimed a board-read pull. */
  private readonly lastSync = new Map<string, number>();
  private readonly pulling = new Set<string>();
  private readonly listeners = new Set<TrackerChangeListener>();
  /** When each project's listeners last ran, or the backstop last found nothing new, and the tracker's HEAD then. */
  private readonly lastLook = new Map<string, { at: number; head: string | null }>();
  /** Set by `stop`: a pass already queued or running does nothing more, and no listener runs (TR-067). */
  private stopped = false;

  constructor(
    private readonly sync: TrackerSyncer = syncTracker,
    private readonly now: () => number = Date.now,
  ) {}

  onChange(listener: TrackerChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  syncProblem(project: string): TrackerSyncProblem | null {
    return this.syncProblems.get(project) ?? null;
  }

  /** Starts watching every project not watched yet; call after onboarding too. */
  async refresh(): Promise<void> {
    for (const config of await listProjectConfigs()) {
      if (this.stopped || this.watched.has(config.project)) continue;
      const paths = await projectPaths(config.project);
      const watchers: FSWatcher[] = [];
      try {
        await mkdir(join(paths.tracker, "tickets"), { recursive: true });
        watchers.push(
          watch(join(paths.tracker, "tickets"), (_event, name) => {
            // No name (some platforms): any ticket may have changed.
            const file = name === null ? undefined : String(name);
            if (file !== undefined && !isTicketFileEvent(file)) return;
            forgetTicketFile(paths.tracker, file);
            this.schedule(config.project);
          }),
        );
        // tracker.json is replaced by rename, so its folder is watched rather than the file itself.
        watchers.push(
          watch(paths.tracker, (_event, name) => {
            if (name !== null && String(name) === "tracker.json") this.schedule(config.project);
          }),
        );
        for (const watcher of watchers) watcher.on("error", (error) => console.error(`[taro] tracker watch for ${config.project} failed: ${error.message}`));
        this.watched.set(config.project, { watchers, timer: null });
      } catch (error) {
        for (const watcher of watchers) watcher.close();
        console.error(`[taro] cannot watch ${config.project}'s tracker: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private schedule(project: string): void {
    const entry = this.watched.get(project);
    if (entry === undefined || this.stopped) return;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.commit(project);
    }, DEBOUNCE_MS);
  }

  /** Commits (and syncs) now; also called after the plugin writes a ticket itself. */
  commit(project: string): Promise<void> {
    return serialized(`tracker:${project}`, async () => {
      if (this.stopped) return;
      const configs = await listProjectConfigs();
      const config = configs.find((candidate) => candidate.project === project);
      if (config === undefined) return;
      const paths = await projectPaths(project);
      try {
        const committed = await commitTracker(paths.tracker);
        if (committed.locked) this.schedule(project);
        if (config.trackerSync !== "remote") this.syncProblems.delete(project);
        else if (committed.subject !== null) await this.syncAndRecord(project, paths.tracker, "rebase");
      } catch (error) {
        if (!this.stopped) console.error(`[taro] committing ${project}'s tracker failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.notify(project, paths.tracker);
    });
  }

  /** The user's answer to a paused sync: pull with their choice and push; a project switched to local only just drops the problem. */
  resolve(project: string, resolution: SyncResolution): Promise<TrackerSyncProblem | null> {
    return serialized(`tracker:${project}`, async () => {
      const config = (await listProjectConfigs()).find((candidate) => candidate.project === project);
      if (config?.trackerSync !== "remote") {
        this.syncProblems.delete(project);
        return null;
      }
      const paths = await projectPaths(project);
      const problem = await this.syncAndRecord(project, paths.tracker, RESOLUTION_STRATEGIES[resolution]);
      await this.notify(project, paths.tracker);
      return problem;
    });
  }

  /**
   * Called on every board read: pulls in the background when the project syncs
   * with the remote and has not synced for a minute. The read never waits for
   * it; when the pull brings commits the listeners run, so the next read shows
   * them. Returns the background pull so tests can await it.
   */
  pullIfDue(project: string): Promise<void> {
    // A hanging remote takes up to two minutes to time out; queuing another pull behind it would hold up commits and Retry.
    if (this.stopped || this.pulling.has(project) || this.syncProblems.get(project)?.kind === "conflict") return Promise.resolve();
    const last = this.lastSync.get(project);
    if (last !== undefined && this.now() - last < PULL_INTERVAL_MS) return Promise.resolve();
    // Claimed before any await: the screen, Inbox and sidebar read together and must queue one pull, not three.
    this.lastSync.set(project, this.now());
    this.pulling.add(project);
    return this.pull(project)
      .catch((error: unknown) => {
        if (!this.stopped) console.error(`[taro] pulling ${project}'s tracker failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => this.pulling.delete(project));
  }

  private pull(project: string): Promise<void> {
    return serialized(`tracker:${project}`, async () => {
      if (this.stopped) return;
      const config = (await listProjectConfigs()).find((candidate) => candidate.project === project);
      if (config?.trackerSync !== "remote") return;
      const paths = await projectPaths(project);
      const before = await this.head(paths.tracker);
      await this.syncAndRecord(project, paths.tracker, "rebase");
      if ((await this.head(paths.tracker)) === before) return;
      await this.notify(project, paths.tracker);
    });
  }

  private async notify(project: string, trackerPath: string): Promise<void> {
    this.lastLook.set(project, { at: this.now(), head: await this.head(trackerPath).catch(() => null) });
    if (this.stopped) return;
    for (const listener of this.listeners) listener(project);
  }

  /**
   * Called every minute. A file-watch event can be missed, and then nothing commits the change or
   * runs the status pass until the next one, which overnight may be hours away. For each project
   * not looked at for five minutes: commits and runs the listeners when the tracker has
   * uncommitted changes or a HEAD the listeners have not seen; otherwise only notes the look. Right
   * after a start the HEAD is taken as seen (the start's catch-up reads the tracker). Returns the
   * projects it ran the listeners for.
   */
  async backstop(): Promise<string[]> {
    const ran: string[] = [];
    for (const config of await listProjectConfigs()) {
      if (this.stopped) break;
      const last = this.lastLook.get(config.project);
      if (last !== undefined && this.now() - last.at < BACKSTOP_INTERVAL_MS) continue;
      try {
        const paths = await projectPaths(config.project);
        const head = await this.head(paths.tracker);
        if (!(await this.uncommitted(paths.tracker)) && (last === undefined || head === last.head)) {
          this.lastLook.set(config.project, { at: this.now(), head });
          continue;
        }
        await this.commit(config.project);
        ran.push(config.project);
      } catch (error) {
        if (!this.stopped) console.error(`[taro] tracker backstop for ${config.project} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return ran;
  }

  private async uncommitted(trackerPath: string): Promise<boolean> {
    const pathspecs = await trackerPathspecs(trackerPath);
    if (pathspecs.length === 0) return false;
    return (await runChecked("git", ["-C", trackerPath, "status", "--porcelain", "--", ...pathspecs], { timeoutMs: 30_000 })).trim() !== "";
  }

  private async head(trackerPath: string): Promise<string> {
    return (await runCommand("git", ["-C", trackerPath, "rev-parse", "HEAD"], { timeoutMs: 30_000 })).stdout.trim();
  }

  private async syncAndRecord(project: string, trackerPath: string, strategy: SyncStrategy): Promise<TrackerSyncProblem | null> {
    let problem: TrackerSyncProblem | null;
    try {
      problem = await this.sync(trackerPath, strategy);
    } finally {
      // Counted from the end, so a slow remote still gets a quiet minute between pulls.
      this.lastSync.set(project, this.now());
    }
    if (problem === null) this.syncProblems.delete(project);
    else this.syncProblems.set(project, problem);
    return problem;
  }

  stop(): void {
    this.stopped = true;
    for (const entry of this.watched.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer);
      for (const watcher of entry.watchers) watcher.close();
    }
    this.watched.clear();
  }
}
