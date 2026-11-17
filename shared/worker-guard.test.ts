import { describe, expect, it } from "vitest";

import { isTicketWorker, sameTicketFamily } from "./worker-guard";

describe("isTicketWorker", () => {
  it("counts the ticket's owner and subagents, and its children's and parent's", () => {
    expect(isTicketWorker({ project: "p", ticket: "TR-7" }, "p", "TR-7")).toBe(true);
    expect(isTicketWorker({ project: "p", ticket: "TR-7.2" }, "p", "TR-7")).toBe(true);
    expect(isTicketWorker({ project: "p", ticket: "TR-7" }, "p", "TR-7.2")).toBe(true);
  });

  it("lets any other session through: another ticket, the manager, an unlabelled agent, another project", () => {
    expect(isTicketWorker({ project: "p", ticket: "TR-8" }, "p", "TR-7")).toBe(false);
    expect(isTicketWorker({ project: "p", ticket: "TR-70" }, "p", "TR-7")).toBe(false);
    expect(isTicketWorker({ project: "p", ticket: null }, "p", "TR-7")).toBe(false);
    expect(isTicketWorker(null, "p", "TR-7")).toBe(false);
    expect(isTicketWorker({ project: "q", ticket: "TR-7" }, "p", "TR-7")).toBe(false);
  });

  it("matches ticket ids whole, not by prefix", () => {
    expect(sameTicketFamily("TR-7", "TR-70")).toBe(false);
  });
});
