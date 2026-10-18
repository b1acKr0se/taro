import { describe, expect, it } from "vitest";

import { composerNotice, hasSomethingToSend, primaryAction, sendLabel } from "./composer-notice";

describe("composerNotice", () => {
  it("says nothing for a plain send, whether the agent works or not", () => {
    expect(composerNotice(false)).toBeNull();
  });

  it("warns that a message turns down a pending permission or question, as it is sent at once", () => {
    expect(composerNotice(true)).toBe("Sending a message now turns down the request above. Answer it first to keep it.");
  });
});

describe("sendLabel (TR-171)", () => {
  it("is Send to an idle agent", () => {
    expect(sendLabel({ working: false, requestPending: false })).toBe("Send");
  });

  it("is Add to queue while the agent works", () => {
    expect(sendLabel({ working: true, requestPending: false })).toBe("Add to queue");
  });

  it("says the request is turned down while one is pending, working or not: the message goes at once", () => {
    expect(sendLabel({ working: true, requestPending: true })).toBe("Send and turn down the request");
    expect(sendLabel({ working: false, requestPending: true })).toBe("Send and turn down the request");
  });
});

describe("hasSomethingToSend", () => {
  it("is words other than blanks, or any attachment", () => {
    expect(hasSomethingToSend("Fix the export", 0)).toBe(true);
    expect(hasSomethingToSend("", 1)).toBe(true);
    expect(hasSomethingToSend("  \n\t", 2)).toBe(true);
  });

  it("is not an empty or blank box with no attachment", () => {
    expect(hasSomethingToSend("", 0)).toBe(false);
    expect(hasSomethingToSend("  \n\t ", 0)).toBe(false);
  });
});

describe("primaryAction (TR-181), Paseo's resolvePrimaryActionKind", () => {
  it("is Stop only with nothing to send while the agent works", () => {
    expect(primaryAction({ sendable: false, stoppable: true })).toBe("stop");
  });

  it("stays Send with something to send, working or not", () => {
    expect(primaryAction({ sendable: true, stoppable: true })).toBe("send");
    expect(primaryAction({ sendable: true, stoppable: false })).toBe("send");
  });

  it("is a dimmed Send with nothing to send to an idle agent", () => {
    expect(primaryAction({ sendable: false, stoppable: false })).toBe("send");
  });
});
