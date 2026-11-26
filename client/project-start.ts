/**
 * The start question's words and moves, kept apart from React Native so vitest can read them:
 * what each choice says, the input each press sends, and the phone tab a project that asks opens on.
 */
import type { ProjectStart } from "../shared/project";
import type { PhoneTab } from "./back-steps";

export const START_TITLE = "Is this a brand new project?";
export const START_SUBTITLE = "This repository has no files yet.";
/** Shown over the no-manager line once Brand new was chosen while no manager ran. */
export const TOLD_AT_START = "The manager will get this when it starts.";

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

/** Whether the no-manager pane says the manager will get the new-project message when it starts. */
export function waitsForManager(start: ProjectStart | null, managerRunning: boolean): boolean {
  return start === "new" && !managerRunning;
}
