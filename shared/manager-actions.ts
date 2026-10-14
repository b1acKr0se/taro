/**
 * The Manager's actions in project settings, the crashed alert and the Manager pane (TR-072):
 * resume the same agent and conversation, or start a fresh one. Pure.
 */

export type ManagerActionKind = "launch" | "resume" | "fresh";

export const MANAGER_ACTION_LABELS: Readonly<Record<ManagerActionKind, string>> = {
  launch: "Start Manager",
  resume: "Resume Manager",
  fresh: "Start a fresh Manager",
};

export const MANAGER_ACTION_SUCCESS: Readonly<Record<ManagerActionKind, string>> = {
  launch: "Manager started.",
  resume: "Manager resumed with its conversation.",
  fresh: "Fresh Manager started; the old conversation is archived.",
};

/** The buttons the settings show and what they say: Start only without a Manager, else Resume and a fresh start. */
export function managerSettingsActions(manager: { status: string } | null): { kinds: ManagerActionKind[]; description: string } {
  if (manager === null) return { kinds: ["launch"], description: "This project has no Manager running. Start one; tickets are kept." };
  const crashed = manager.status === "error";
  return {
    kinds: ["resume", "fresh"],
    description: [
      crashed ? "The Manager stopped with an error." : null,
      "Resume Manager restarts the same Manager in a new process, its conversation kept.",
      "Start a fresh Manager archives this one (archived, not deleted) and starts a new conversation.",
      "Tickets are kept either way.",
    ]
      .filter((line) => line !== null)
      .join(" "),
  };
}

/** The Manager pane's line over a crashed Manager's chat, or null while it is fine. */
export function managerPaneNotice(manager: { status: string } | null): string | null {
  return manager !== null && manager.status === "error" ? "The Manager stopped with an error. Resume Manager brings it back with its conversation." : null;
}
