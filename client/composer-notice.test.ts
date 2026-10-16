import { describe, expect, it } from "vitest";

import { composerNotice, sendLabel } from "./composer-notice";

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
