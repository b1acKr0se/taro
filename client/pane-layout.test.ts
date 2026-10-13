import { describe, expect, it } from "vitest";

import { projectLayout } from "./pane-layout";

describe("projectLayout", () => {
  it("shows the board beside the conversation by default, the ticket staying a tab", () => {
    expect(projectLayout({ compact: false, boardHidden: false, ticketOpen: true })).toEqual({ board: true, ticketBeside: false });
    expect(projectLayout({ compact: false, boardHidden: false, ticketOpen: false })).toEqual({ board: true, ticketBeside: false });
  });

  it("with the board hidden, moves an open ticket to the right-hand panel", () => {
    expect(projectLayout({ compact: false, boardHidden: true, ticketOpen: true })).toEqual({ board: false, ticketBeside: true });
  });

  it("with the board hidden and no ticket open, gives the conversation the whole width", () => {
    expect(projectLayout({ compact: false, boardHidden: true, ticketOpen: false })).toEqual({ board: false, ticketBeside: false });
  });

  it("leaves a phone alone whatever was chosen on a wide screen", () => {
    expect(projectLayout({ compact: true, boardHidden: true, ticketOpen: true })).toEqual({ board: false, ticketBeside: false });
    expect(projectLayout({ compact: true, boardHidden: false, ticketOpen: false })).toEqual({ board: false, ticketBeside: false });
  });
});
