import { describe, expect, it } from "vitest";

import {
  chooseMove,
  createBackStack,
  planShown,
  pressBack,
  screenBackStep,
  ticketBackMove,
  ticketBackTarget,
  ticketOrigin,
  ticketShown,
  viewPlanMove,
  type OpenPlan,
  type PhoneTab,
  type ScreenMove,
  type ScreenPlace,
  type TicketFrom,
} from "./back-steps";

describe("createBackStack", () => {
  it("takes no step when nothing is open, so back leaves Taro", () => {
    expect(createBackStack().handle()).toBe(false);
  });

  it("closes the newest open thing first, then the one under it", () => {
    const stack = createBackStack();
    const closed: string[] = [];
    const removeTicket = stack.push(() => closed.push("ticket"));
    const removePicker = stack.push(() => closed.push("picker"));
    expect(stack.handle()).toBe(true);
    expect(closed).toEqual(["picker"]);
    // The picker's own close removes its step, as its effect cleanup does.
    removePicker();
    expect(stack.handle()).toBe(true);
    expect(closed).toEqual(["picker", "ticket"]);
    removeTicket();
    expect(stack.handle()).toBe(false);
  });

  it("removes a step that closed out of order, and only once", () => {
    const stack = createBackStack();
    const closed: string[] = [];
    const removeFirst = stack.push(() => closed.push("first"));
    stack.push(() => closed.push("second"));
    removeFirst();
    removeFirst();
    expect(stack.size).toBe(1);
    stack.handle();
    expect(closed).toEqual(["second"]);
  });
});

describe("pressBack", () => {
  it("closes what is open without stepping the screen back", () => {
    const stack = createBackStack();
    stack.push(() => undefined);
    let screenSteps = 0;
    expect(pressBack(stack, () => (screenSteps++, true))).toBe(true);
    expect(screenSteps).toBe(0);
  });

  it("asks the screen when nothing is open, and leaves Taro when it takes no step", () => {
    const stack = createBackStack();
    expect(pressBack(stack, () => true)).toBe(true);
    expect(pressBack(stack, () => false)).toBe(false);
  });
});

describe("screenBackStep", () => {
  it("returns from settings to the project", () => {
    expect(screenBackStep({ view: "settings", hasProject: true, creating: false })).toBe("to-project");
  });

  it("returns from New project to the project, but not while a project is being created", () => {
    expect(screenBackStep({ view: "setup", hasProject: true, creating: false })).toBe("to-project");
    expect(screenBackStep({ view: "setup", hasProject: true, creating: true })).toBeNull();
  });

  it("leaves Taro from its top level: a project's tabs, the wide Inbox, the first project's setup", () => {
    expect(screenBackStep({ view: "project", hasProject: true, creating: false })).toBeNull();
    expect(screenBackStep({ view: "inbox", hasProject: true, creating: false })).toBeNull();
    expect(screenBackStep({ view: "setup", hasProject: false, creating: false })).toBeNull();
    expect(screenBackStep({ view: "settings", hasProject: false, creating: false })).toBeNull();
  });
});

describe("ticketOrigin", () => {
  it("remembers the project and view a ticket is opened from", () => {
    expect(ticketOrigin({ ticketOpen: false, project: "notes-app", view: "project" })).toEqual({ project: "notes-app", view: "project" });
    expect(ticketOrigin({ ticketOpen: false, project: "notes-app", view: "inbox" })).toEqual({ project: "notes-app", view: "inbox" });
    expect(ticketOrigin({ ticketOpen: false, project: null, view: "settings" })).toEqual({ project: null, view: "project" });
  });

  it("keeps the first origin when a ticket opens another", () => {
    expect(ticketOrigin({ ticketOpen: true, project: "shop-api", view: "project" })).toBeNull();
  });
});

describe("ticketBackTarget", () => {
  it("names the phone tab the ticket returns to", () => {
    expect(ticketBackTarget(true, "manager", "project")).toBe("Manager");
    expect(ticketBackTarget(true, "inbox", "project")).toBe("Inbox");
    expect(ticketBackTarget(true, "board", "project")).toBe("Board");
    expect(ticketBackTarget(true, "stats", "project")).toBe("Stats");
  });

  it("names the wide Inbox or the Manager on a wide screen", () => {
    expect(ticketBackTarget(false, "board", "inbox")).toBe("Inbox");
    expect(ticketBackTarget(false, "board", "project")).toBe("Manager");
  });
});

describe("ticketShown", () => {
  it("is none without a ticket", () => {
    expect(ticketShown({ ticket: null, boardLoaded: true, cardFound: false })).toBe("none");
  });

  it("is open while its card is drawn, or while the board is still loading", () => {
    expect(ticketShown({ ticket: "NA-002", boardLoaded: true, cardFound: true })).toBe("open");
    expect(ticketShown({ ticket: "NA-002", boardLoaded: false, cardFound: false })).toBe("open");
  });

  it("is missing once the board has loaded without its card", () => {
    expect(ticketShown({ ticket: "NA-002", boardLoaded: true, cardFound: false })).toBe("missing");
  });
});

/** The screen as `taro-screen.tsx` keeps it, moved the way its `go` applies a move. */
interface Screen {
  place: ScreenPlace;
  ticketFrom: TicketFrom;
  plan: OpenPlan | null;
}

function start(place: Partial<ScreenPlace>, ticketFrom: TicketFrom = { project: null, view: "project" }): Screen {
  return { place: { project: "notes", view: "project", ticket: null, phoneTab: "manager", ...place }, ticketFrom, plan: null };
}

const nowOf = (screen: Screen) => ({ ...screen.place, ticketOpen: screen.place.ticket !== null });

function apply(screen: Screen, move: ScreenMove): Screen {
  return {
    place: { project: move.project, view: move.view, ticket: move.ticket, phoneTab: move.phoneTab ?? screen.place.phoneTab },
    ticketFrom: move.ticketFrom ?? screen.ticketFrom,
    plan: move.plan,
  };
}

const choose = (screen: Screen, project: string | null, view: ScreenPlace["view"], ticket: string | null = null) => apply(screen, chooseMove(nowOf(screen), project, view, ticket));
const viewPlan = (screen: Screen, project: string, ticket: string) => apply(screen, viewPlanMove(nowOf(screen), screen.plan, project, ticket));
const back = (screen: Screen) => apply(screen, ticketBackMove(nowOf(screen), screen.plan, screen.ticketFrom));
/** The ticket's Chat tab, chosen while its plan shows: the plan closes (`onLeavePlan`). */
const leavePlan = (screen: Screen): Screen => ({ ...screen, plan: null });

describe("View plan and Back (TR-061)", () => {
  it("returns from a plan to the wide Inbox it was opened from", () => {
    const inbox = start({ view: "inbox" });
    const inPlan = viewPlan(inbox, "shop", "SH-004");
    expect(inPlan.place).toMatchObject({ project: "shop", view: "project", ticket: "SH-004" });
    expect(planShown(inPlan.plan, inPlan.place.ticket)).toBe(true);
    const backAgain = back(inPlan);
    expect(backAgain.place).toEqual(inbox.place);
    expect(backAgain.plan).toBeNull();
  });

  it("returns from a plan to the phone's Inbox tab", () => {
    const inbox = start({ phoneTab: "inbox" });
    const inPlan = viewPlan(inbox, "notes", "NA-002");
    expect(back(inPlan).place).toEqual({ project: "notes", view: "project", ticket: null, phoneTab: "inbox" });
  });

  it("returns from a plan to the board: the project view on a wide screen, the Board tab on a phone", () => {
    expect(back(viewPlan(start({}), "notes", "NA-002")).place).toEqual({ project: "notes", view: "project", ticket: null, phoneTab: "manager" });
    expect(back(viewPlan(start({ phoneTab: "board" }), "notes", "NA-002")).place).toEqual({ project: "notes", view: "project", ticket: null, phoneTab: "board" });
  });

  it("puts back the phone tab View plan was pressed on, though the plan's project opened on another", () => {
    const inPlan = viewPlan(start({ project: "shop", phoneTab: "inbox" }), "notes", "NA-002");
    // As if the plan's project view had its tab changed: Back still lands on the Inbox tab of the first project.
    const moved: Screen = { ...inPlan, place: { ...inPlan.place, phoneTab: "board" as PhoneTab } };
    expect(back(moved).place).toEqual({ project: "shop", view: "project", ticket: null, phoneTab: "inbox" });
  });

  it("returns to the owner's chat it was pressed in, on the same ticket or another", () => {
    const sameChat = start({ ticket: "NA-002" }, { project: "notes", view: "project" });
    const fromSame = back(viewPlan(sameChat, "notes", "NA-002"));
    expect(fromSame.place).toEqual(sameChat.place);
    expect(planShown(fromSame.plan, fromSame.place.ticket)).toBe(false);

    const otherChat = start({ ticket: "NA-001" }, { project: "notes", view: "inbox" });
    const fromOther = back(viewPlan(otherChat, "notes", "NA-002"));
    expect(fromOther.place).toEqual(otherChat.place);
    // That chat's own Back still goes where it was opened from.
    expect(back(fromOther).place).toMatchObject({ view: "inbox", ticket: null });
  });

  it("keeps the first return point when View plan is pressed again inside a plan", () => {
    const inbox = start({ view: "inbox" });
    const twice = viewPlan(viewPlan(inbox, "notes", "NA-002"), "notes", "NA-003");
    expect(twice.place.ticket).toBe("NA-003");
    expect(planShown(twice.plan, "NA-003")).toBe(true);
    expect(back(twice).place).toEqual(inbox.place);
  });

  it("after switching to Chat, Back takes the ticket's own way: where it was opened from", () => {
    const inbox = start({ view: "inbox" });
    const inChat = leavePlan(viewPlan(inbox, "notes", "NA-002"));
    expect(planShown(inChat.plan, inChat.place.ticket)).toBe(false);
    expect(inChat.ticketFrom).toEqual({ project: "notes", view: "inbox" });
    expect(back(inChat).place).toEqual({ project: "notes", view: "inbox", ticket: null, phoneTab: "manager" });

    // Pressed in another ticket's chat, the plan's ticket keeps that first ticket's origin (TR-065).
    const fromBoard = start({ ticket: "NA-001" }, { project: "notes", view: "project" });
    expect(back(leavePlan(viewPlan(fromBoard, "notes", "NA-002"))).place).toEqual({ project: "notes", view: "project", ticket: null, phoneTab: "manager" });
  });

  it("leaves the plan on any other move, so Back no longer returns from it", () => {
    const inPlan = viewPlan(start({ view: "inbox" }), "notes", "NA-002");
    const elsewhere = choose(inPlan, "notes", "project", "NA-005");
    expect(elsewhere.plan).toBeNull();
    expect(back(elsewhere).place).toMatchObject({ view: "inbox", ticket: null });
  });

  it("makes Android's back while a plan is open do what the Back button does", () => {
    // `use-back.ts` pushes the open ticket's step with the same handler its Back button runs.
    let screen = viewPlan(start({ view: "inbox" }), "notes", "NA-002");
    const button = back(screen);
    const stack = createBackStack();
    stack.push(() => {
      screen = back(screen);
    });
    expect(pressBack(stack, () => false)).toBe(true);
    expect(screen).toEqual(button);
  });
});

describe("planShown", () => {
  const plan: OpenPlan = { ticket: "NA-002", back: { project: "notes", view: "inbox", ticket: null, phoneTab: "manager" } };

  it("shows the plan only on its own ticket", () => {
    expect(planShown(plan, "NA-002")).toBe(true);
    expect(planShown(plan, "NA-001")).toBe(false);
    expect(planShown(plan, null)).toBe(false);
    expect(planShown(null, "NA-002")).toBe(false);
  });
});
