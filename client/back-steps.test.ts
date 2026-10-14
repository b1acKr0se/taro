import { describe, expect, it } from "vitest";

import { createBackStack, pressBack, screenBackStep, ticketBackTarget, ticketOrigin, ticketShown } from "./back-steps";

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
