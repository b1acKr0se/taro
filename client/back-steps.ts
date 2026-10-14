/**
 * Android's back inside the Taro screen (TR-065). The plugin SDK has no back API, so the screen
 * listens to React Native's `BackHandler` (`use-back.ts`) and steps back through Taro itself: an
 * open overlay closes first, then an open ticket, then the screen's own step; with nothing left,
 * back leaves Taro.
 * Pure, so the order is tested without React Native.
 */

/** What is open over the screen (overlays, a ticket), newest last; back closes the newest. */
export function createBackStack() {
  const steps: { run: () => void }[] = [];
  return {
    /** Adds a step while something is open; the returned function removes it when it closes. */
    push(run: () => void): () => void {
      const step = { run };
      steps.push(step);
      return () => {
        const index = steps.indexOf(step);
        if (index !== -1) steps.splice(index, 1);
      };
    },
    /** Runs the newest step; false when nothing is open. */
    handle(): boolean {
      const step = steps[steps.length - 1];
      if (step === undefined) return false;
      step.run();
      return true;
    },
    get size(): number {
      return steps.length;
    },
  };
}

/**
 * The screen's own step back, once no overlay or open ticket took it: settings and New project
 * return to the project. A project's tabs (and the wide Inbox) are Taro's top level, where back
 * leaves Taro; so does a project being created, which carries on while the user is away.
 */
export function screenBackStep(state: { view: "inbox" | "project" | "setup" | "settings"; hasProject: boolean; creating: boolean }): "to-project" | null {
  if (!state.hasProject) return null;
  if (state.view === "settings") return "to-project";
  if (state.view === "setup" && !state.creating) return "to-project";
  return null;
}

/** Where the ticket's Back button returns, as it names it: the phone tab, or the wide Inbox or Manager. */
export function ticketBackTarget(compact: boolean, phoneTab: "manager" | "inbox" | "board" | "stats", returnView: string): string {
  if (!compact) return returnView === "inbox" ? "Inbox" : "Manager";
  const names = { manager: "Manager", inbox: "Inbox", board: "Board", stats: "Stats" };
  return names[phoneTab];
}

/**
 * Whether the ticket in the screen's state is drawn: "missing" once the board has loaded without
 * its card (archived while open), where the project's tabs show and back leaves Taro as at the top
 * level. One answer for the back step, the tab bar and where a newly opened ticket returns.
 */
export function ticketShown(state: { ticket: string | null; boardLoaded: boolean; cardFound: boolean }): "open" | "missing" | "none" {
  if (state.ticket === null) return "none";
  if (state.cardFound || !state.boardLoaded) return "open";
  return "missing";
}

/**
 * Where a ticket being opened returns to: the project and view showing now. Null while a ticket is
 * already open (its Answer → opens another), so Back still returns to where the first was opened.
 */
export function ticketOrigin(state: { ticketOpen: boolean; project: string | null; view: "inbox" | "project" | "setup" | "settings" }): {
  project: string | null;
  view: "inbox" | "project";
} | null {
  if (state.ticketOpen) return null;
  return { project: state.project, view: state.view === "inbox" ? "inbox" : "project" };
}

/** One press of back: the newest open thing closes, else the screen steps back; false leaves Taro. */
export function pressBack(open: { handle(): boolean }, screenStep: () => boolean): boolean {
  return open.handle() || screenStep();
}
