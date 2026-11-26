/**
 * The start question's words and moves, kept apart from React Native so vitest can read them:
 * what each choice says, the input each press sends, and the phone tab a project that asks opens on.
 */
import { NO_MANAGER_RUNNING, type ProjectStart } from "../shared/project";
import type { PhoneTab } from "./back-steps";

export const START_TITLE = "Is this a brand new project?";
export const START_SUBTITLE = "This repository has no files yet.";
/** Shown over the no-manager line once Brand new was chosen while no manager ran. */
export const TOLD_AT_START = "Brand new project: the manager starts asking about it as soon as it runs.";

export interface StartChoice {
  choice: ProjectStart;
  title: string;
  description: string;
}

export const START_CHOICES: readonly StartChoice[] = [
  { choice: "new", title: "Brand new project", description: "Work out what to build with you first, then build it task by task." },
  { choice: "existing", title: "Existing project", description: "Go straight to the manager and tell it what you need." },
];

/** The `taro.project.start` input a press sends. */
export function startInput(project: string, choice: ProjectStart): { project: string; choice: ProjectStart } {
  return { project, choice };
}

/** A project that asks opens on its Manager tab, where the question is, whichever tab was last shown. */
export function phoneTabFor(askStart: boolean, tab: PhoneTab): PhoneTab {
  return askStart ? "manager" : tab;
}

/**
 * Whether the no-manager pane says the manager will get the new-project message when it starts: only
 * while that is true, Brand new chosen with no ticket yet (`newProjectPending` on the summary).
 */
export function waitsForManager(newProjectPending: boolean, managerRunning: boolean): boolean {
  return newProjectPending && !managerRunning;
}

/** What `taro.project.start` answered. */
export interface StartAnswer {
  told: boolean;
  reason?: string | undefined;
  message?: string | undefined;
}

/**
 * The line kept above the manager's chat after a press: the answer's own words when a running
 * manager could not be told (they say why), so that Brand new is not silent. None when it was told,
 * for an existing project, or when no manager ran: the no-manager pane says so from the summary,
 * and the manager that starts next gets the message, so a kept line would go stale.
 */
export function startNotice(choice: ProjectStart, answer: StartAnswer): string | null {
  if (answer.told || choice === "existing" || answer.reason === NO_MANAGER_RUNNING) return null;
  return answer.message ?? answer.reason ?? null;
}
