/**
 * The plugin is the tracker's only committer (decision 31): each project's
 * `tracker/backlog/` is watched, and changes are committed a few seconds
 * after the last write. With remote sync on, each commit is pushed after a
 * pull; a failure is kept and shown, and retried on the next change.
 */
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

import { listProjectConfigs, projectPaths } from "./projects";
import { serialized } from "./serialize";
import { commitTracker, syncTracker } from "./tracker";

const DEBOUNCE_MS = 5_000;

export type TrackerChangeListener = (project: string) => void;

interface Watched {
  watcher: FSWatcher;
  timer: NodeJS.Timeout | null;
}

export class TrackerWatch {
  private readonly watched = new Map<string, Watched>();
  private readonly syncProblems = new Map<string, string>();
  private readonly listeners = new Set<TrackerChangeListener>();

  onChange(listener: TrackerChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  syncProblem(project: string): string | null {
    return this.syncProblems.get(project) ?? null;
  }

  /** Starts watching every project not watched yet; call after onboarding too. */
  async refresh(): Promise<void> {
    for (const config of await listProjectConfigs()) {
      if (this.watched.has(config.project)) continue;
      const paths = await projectPaths(config.project);
      try {
        const watcher = watch(join(paths.tracker, "backlog"), { recursive: true }, () => this.schedule(config.project));
        watcher.on("error", (error) => console.error(`[taro] tracker watch for ${config.project} failed: ${error.message}`));
        this.watched.set(config.project, { watcher, timer: null });
      } catch (error) {
        console.error(`[taro] cannot watch ${config.project}'s tracker: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private schedule(project: string): void {
    const entry = this.watched.get(project);
    if (entry === undefined) return;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.commit(project);
    }, DEBOUNCE_MS);
  }

  /** Commits (and syncs) now; also called after the plugin writes a ticket itself. */
  commit(project: string): Promise<void> {
    return serialized(`tracker:${project}`, async () => {
      const configs = await listProjectConfigs();
      const config = configs.find((candidate) => candidate.project === project);
      if (config === undefined) return;
      const paths = await projectPaths(project);
      try {
        const committed = await commitTracker(paths.tracker);
        if (config.trackerSync === "remote" && (committed !== null || this.syncProblems.has(project))) {
          const result = await syncTracker(paths.tracker);
          if (result.ok) this.syncProblems.delete(project);
          else this.syncProblems.set(project, result.reason);
        }
      } catch (error) {
        console.error(`[taro] committing ${project}'s tracker failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      for (const listener of this.listeners) listener(project);
    });
  }

  stop(): void {
    for (const entry of this.watched.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.watcher.close();
    }
    this.watched.clear();
  }
}
