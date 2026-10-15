/**
 * The manager's actions in project settings, the crashed alert and the manager pane (TR-072):
 * resume the same agent and conversation, or start a fresh one. Pure.
 */

export type ManagerActionKind = "launch" | "resume" | "fresh";

export const MANAGER_ACTION_LABELS: Readonly<Record<ManagerActionKind, string>> = {
  launch: "Start manager",
  resume: "Resume manager",
  fresh: "Start a fresh manager",
};

export const MANAGER_ACTION_SUCCESS: Readonly<Record<ManagerActionKind, string>> = {
  launch: "The manager started.",
  resume: "The manager resumed with its conversation.",
  fresh: "Fresh manager started; the old conversation is archived.",
};

/** The buttons the settings show and what they say: Start only without a manager, else Resume and a fresh start. */
export function managerSettingsActions(manager: { status: string } | null): { kinds: ManagerActionKind[]; description: string } {
  if (manager === null) return { kinds: ["launch"], description: "This project has no manager running. Start one; tickets are kept." };
  const crashed = manager.status === "error";
  return {
    kinds: ["resume", "fresh"],
    description: [
      crashed ? "The manager stopped with an error." : null,
      "Resume manager restarts the same manager in a new process, its conversation kept.",
      "Start a fresh manager archives this one (archived, not deleted) and starts a new conversation.",
      "Tickets are kept either way.",
    ]
      .filter((line) => line !== null)
      .join(" "),
  };
}

/** The manager pane's line over a crashed manager's chat, or null while it is fine. */
export function managerPaneNotice(manager: { status: string } | null): string | null {
  return manager !== null && manager.status === "error" ? "The manager stopped with an error. Resume manager brings it back with its conversation." : null;
}
