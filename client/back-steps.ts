/**
 * Android's back inside the Taro screen (TR-065). The plugin SDK has no back API, so the screen
 * listens to React Native's `BackHandler` (`use-back.ts`) and steps back through Taro itself: an
 * open overlay closes first, then an open ticket, then the screen's own step; with nothing left,
 * back leaves Taro. The screen's moves live here too: opening a ticket, View plan (TR-061) and the
 * open ticket's Back, so where each lands is tested without React Native.
 */

export type ScreenView = "inbox" | "project" | "setup" | "settings";
export type PhoneTab = "manager" | "inbox" | "board" | "stats";

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
export function screenBackStep(state: { view: ScreenView; hasProject: boolean; creating: boolean }): "to-project" | null {
  if (!state.hasProject) return null;
  if (state.view === "settings") return "to-project";
  if (state.view === "setup" && !state.creating) return "to-project";
  return null;
}

/** Where the ticket's Back button returns, as it names it: the phone tab, or the wide Inbox or manager. */
export function ticketBackTarget(compact: boolean, phoneTab: PhoneTab, returnView: string): string {
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
export function ticketOrigin(state: { ticketOpen: boolean; project: string | null; view: ScreenView }): TicketFrom | null {
  if (state.ticketOpen) return null;
  return { project: state.project, view: state.view === "inbox" ? "inbox" : "project" };
}

/** Where the screen is: a project, its view, the open ticket, and the phone's tab. */
export interface ScreenPlace {
  project: string | null;
  view: ScreenView;
  ticket: string | null;
  phoneTab: PhoneTab;
}

/** Where the open ticket was opened from, for its Back (TR-065). */
export interface TicketFrom {
  project: string | null;
  view: "inbox" | "project";
}

/** View plan (TR-061): the ticket whose plan is open, and where Back from it returns. */
export interface OpenPlan {
  ticket: string;
  back: ScreenPlace;
}

/**
 * Where the screen goes. `ticketFrom` and `phoneTab` are null where they stay as they are; `plan`
 * is the plan open after the move (any move but View plan leaves it).
 */
export interface ScreenMove {
  project: string | null;
  view: ScreenView;
  ticket: string | null;
  phoneTab: PhoneTab | null;
  ticketFrom: TicketFrom | null;
  plan: OpenPlan | null;
}

/** The screen now: the project shown, the view shown, the ticket drawn (`ticketShown` is "open") and the phone's tab. */
export interface ScreenNow extends ScreenPlace {
  ticketOpen: boolean;
}

/** Going to a project's view, or to a ticket in it: a ticket opened remembers where from (`ticketOrigin`). */
export function chooseMove(now: ScreenNow, project: string | null, view: ScreenView, ticket: string | null = null): ScreenMove {
  const ticketFrom = ticket === null ? null : ticketOrigin({ ticketOpen: now.ticketOpen, project: now.project, view: now.view });
  return { project, view, ticket, phoneTab: null, ticketFrom, plan: null };
}

/**
 * View plan pressed on `ticket`'s card: its Ticket tab opens, and Back from it returns to where the
 * user is now; pressed again from inside a plan (`plan` open), still to where the first was pressed.
 */
export function viewPlanMove(now: ScreenNow, plan: OpenPlan | null, project: string, ticket: string): ScreenMove {
  const here: ScreenPlace = { project: now.project, view: now.view, ticket: now.ticket, phoneTab: now.phoneTab };
  return { ...chooseMove(now, project, "project", ticket), plan: { ticket, back: plan?.back ?? here } };
}

/** Whether the open ticket shows its plan: the plan is open on that very ticket. */
export function planShown(plan: OpenPlan | null, ticket: string | null): boolean {
  return plan !== null && ticket !== null && plan.ticket === ticket;
}

/**
 * The open ticket's Back, its button's and Android's alike: from a plan, to where View plan was
 * pressed (the phone tab too); otherwise to where the ticket was opened from. Leaving the plan for
 * the ticket's Chat closes the plan (`plan` null), so Back then takes the ticket's own way.
 */
export function ticketBackMove(now: ScreenNow, plan: OpenPlan | null, ticketFrom: TicketFrom): ScreenMove {
  if (plan !== null && planShown(plan, now.ticket)) {
    const back = plan.back;
    return { ...chooseMove(now, back.project, back.view, back.ticket), phoneTab: back.phoneTab };
  }
  return chooseMove(now, ticketFrom.project ?? now.project, ticketFrom.view);
}

/** One press of back: the newest open thing closes, else the screen steps back; false leaves Taro. */
export function pressBack(open: { handle(): boolean }, screenStep: () => boolean): boolean {
  return open.handle() || screenStep();
}
