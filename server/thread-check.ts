/**
 * The host's thread headroom, read before `taro` starts an agent or a test daemon: each Claude agent
 * costs about 65 of the cgroup's pids, and at the limit the host crashes agents. Above 85% it waits
 * for usage to drop, then refuses. Plain Node, erasable TypeScript: the `taro` command reaches it.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Waiting starts above this share of `pids.max`. */
export const THREAD_LIMIT = 0.85;

export interface ThreadUsage {
  current: number;
  max: number;
}

/** `pids.current` and `pids.max` in the cgroup folder; null where they are missing or the max is `max` (no limit). */
export async function readThreadUsage(cgroupDirectory: string): Promise<ThreadUsage | null> {
  try {
    const [current, max] = await Promise.all([readFile(join(cgroupDirectory, "pids.current"), "utf8"), readFile(join(cgroupDirectory, "pids.max"), "utf8")]);
    const currentCount = Number(current.trim());
    const maxCount = Number(max.trim());
    if (!Number.isFinite(currentCount) || !Number.isFinite(maxCount) || maxCount <= 0) return null;
    return { current: currentCount, max: maxCount };
  } catch {
    return null;
  }
}

export function overLimit(usage: ThreadUsage | null): boolean {
  return usage !== null && usage.current / usage.max > THREAD_LIMIT;
}

function describe(usage: ThreadUsage): string {
  return `${Math.round((usage.current / usage.max) * 100)}% (${usage.current} of ${usage.max})`;
}

/**
 * Waits up to `waitSeconds` while usage is above the limit, reading again every `pollMs`; returns
 * null when there is room, else why it is refusing.
 */
export async function waitForThreads(options: { cgroupDirectory: string; waitSeconds: number; pollMs: number; what: string; log(text: string): void }): Promise<string | null> {
  const deadline = Date.now() + options.waitSeconds * 1000;
  let usage = await readThreadUsage(options.cgroupDirectory);
  let told = false;
  while (overLimit(usage) && Date.now() < deadline) {
    if (!told && usage !== null) options.log(`Threads at ${describe(usage)}, above ${THREAD_LIMIT * 100}%: waiting up to ${options.waitSeconds} s before starting ${options.what}.\n`);
    told = true;
    await new Promise((resolve) => setTimeout(resolve, Math.min(options.pollMs, Math.max(0, deadline - Date.now()))));
    usage = await readThreadUsage(options.cgroupDirectory);
  }
  if (!overLimit(usage) || usage === null) return null;
  return `Not starting ${options.what}: threads are at ${describe(usage)}, above ${THREAD_LIMIT * 100}% after waiting ${options.waitSeconds} s. Stop finished subagents and test daemons (taro agent stop, taro daemon stop), then try again.`;
}
