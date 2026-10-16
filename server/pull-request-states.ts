/**
 * Pull requests' live states for the board's PR marks (TR-152). The board never waits on GitHub: a
 * read answers what is known now and asks gh in the background, so the next poll shows the answer.
 */
import { GH_STATE_FIELDS, parsePullRequestState, stateLifetimeMs, type PullRequestState } from "../shared/pull-request-state";
import { runCommand, type CommandOptions, type CommandResult } from "./process";

const GH_TIMEOUT_MS = 15_000;

/** A first board read may name every PR on its pages; a few gh calls at a time are plenty. */
const MAX_RUNNING = 3;

type Run = (command: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>;

export interface PullRequestStates {
  /** The state last read for the URL, or null when none is known yet; reads it again in the background once it is old. */
  current(url: string): PullRequestState | null;
}

export function createPullRequestStates(run: Run = runCommand, now: () => number = () => Date.now()): PullRequestStates {
  const known = new Map<string, { state: PullRequestState | null; until: number }>();
  const waiting: string[] = [];
  const asking = new Set<string>();
  let running = 0;

  function next(): void {
    while (running < MAX_RUNNING && waiting.length > 0) {
      const url = waiting.shift() ?? "";
      running++;
      void ask(url).finally(() => {
        running--;
        asking.delete(url);
        next();
      });
    }
  }

  async function ask(url: string): Promise<void> {
    const result = await run("gh", ["pr", "view", url, "--json", GH_STATE_FIELDS], { timeoutMs: GH_TIMEOUT_MS }).catch(() => null);
    const state = result === null || result.code !== 0 ? null : parsePullRequestState(result.stdout);
    // A failed read keeps the last good answer, and waits before asking again.
    const previous = known.get(url)?.state ?? null;
    known.set(url, { state: state ?? previous, until: now() + stateLifetimeMs(state) });
  }

  return {
    current(url) {
      const entry = known.get(url);
      const fresh = entry !== undefined && now() < entry.until;
      if (!fresh && !asking.has(url)) {
        asking.add(url);
        waiting.push(url);
        next();
      }
      return entry?.state ?? null;
    },
  };
}
