/**
 * Creating a project from the New project pages (TR-056): a quick check whose problems go beside
 * their fields, then the tracker, then the Manager, while the screen shows the new project's
 * progress. The progress is kept on `globalThis` (`kept.ts`), so leaving the screen or the bundle
 * being evaluated again does not lose it; the calls already sent finish and write into the same slot.
 */
import type { ProjectSettings } from "../shared/project";
import type { SetupProblems } from "../shared/setup-form";
import { keptObject } from "./kept";

export type CreationStep = "idle" | "tracker" | "manager" | "done" | "failed";

export interface CreationCalls {
  check: (input: { project: string; settings: ProjectSettings }) => Promise<{ problems: { [Key in keyof SetupProblems]?: string | undefined } }>;
  onboard: (input: { project: string; settings: ProjectSettings; startManager: boolean }) => Promise<unknown>;
  launch: (input: { project: string }) => Promise<unknown>;
}

export interface CreationState {
  project: string | null;
  step: CreationStep;
  /** The step that failed, when `step` is "failed": the tracker (nothing to open) or the Manager (the project exists). */
  failedStep: "tracker" | "manager" | null;
  error: string | null;
}

export function creationDefaults(): CreationState {
  return { project: null, step: "idle", failedStep: null, error: null };
}

export const creation: CreationState = keptObject(globalThis, "project-creation-v1", creationDefaults());

export function resetCreation(state: CreationState = creation): void {
  Object.assign(state, creationDefaults());
}

function message(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * Checks the project, then sets it up in the background. Resolves with the problems when the check
 * finds any (nothing is created), else null once the tracker and Manager steps are under way; the
 * steps then move `state` on to "done" or "failed".
 */
export async function startCreation(
  calls: CreationCalls,
  project: string,
  settings: ProjectSettings,
  state: CreationState = creation,
): Promise<{ problems: SetupProblems | null; finished: Promise<void> }> {
  const checked = (await calls.check({ project, settings })).problems;
  const problems: SetupProblems = Object.fromEntries(Object.entries(checked).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  if (Object.keys(problems).length > 0) return { problems, finished: Promise.resolve() };
  Object.assign(state, { project, step: "tracker", failedStep: null, error: null } satisfies CreationState);
  const finished = (async () => {
    try {
      await calls.onboard({ project, settings, startManager: false });
    } catch (caught) {
      Object.assign(state, { step: "failed", failedStep: "tracker", error: message(caught) });
      return;
    }
    state.step = "manager";
    try {
      await calls.launch({ project });
      state.step = "done";
    } catch (caught) {
      Object.assign(state, { step: "failed", failedStep: "manager", error: message(caught) });
    }
  })();
  return { problems: null, finished };
}

/** Starts the Manager again after it failed to start; the project and its tracker are there already. */
export async function retryManager(calls: Pick<CreationCalls, "launch">, state: CreationState = creation): Promise<void> {
  const project = state.project;
  if (project === null) return;
  Object.assign(state, { step: "manager", failedStep: null, error: null });
  try {
    await calls.launch({ project });
    state.step = "done";
  } catch (caught) {
    Object.assign(state, { step: "failed", failedStep: "manager", error: message(caught) });
  }
}
