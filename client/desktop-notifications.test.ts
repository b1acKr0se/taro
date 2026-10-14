import { describe, expect, it, vi } from "vitest";

import { desktopNotifier, pageVisible, toastText, windowFocused } from "./desktop-notifications";

const shown = { title: "NA-1 is ready to accept", body: "Drafts sync.", data: { serverId: "srv_1", agentId: "agent-1" } };

describe("desktopNotifier", () => {
  it("uses the desktop shell's notifier, called on its own object", () => {
    const notification = { sendNotification: vi.fn(function (this: unknown) { return this === notification; }) };
    const show = desktopNotifier({ paseoDesktop: { notification } });
    show?.(shown);
    expect(notification.sendNotification).toHaveBeenCalledWith(shown);
    expect(notification.sendNotification.mock.results[0]?.value).toBe(true);
  });

  it("accepts a shell that answers with a rejection, a plain value or a throw", async () => {
    const rejecting = desktopNotifier({ paseoDesktop: { notification: { sendNotification: () => Promise.reject(new Error("denied")) } } });
    const throwing = desktopNotifier({ paseoDesktop: { notification: { sendNotification: () => { throw new Error("gone"); } } } });
    expect(() => rejecting?.(shown)).not.toThrow();
    expect(() => throwing?.(shown)).not.toThrow();
    await Promise.resolve();
  });

  it("falls back to the web Notification once allowed, focusing the window on a click", () => {
    const made: { title: string; options: unknown; onclick?: () => void }[] = [];
    function Web(this: { onclick?: () => void }, title: string, options: unknown) {
      made.push(Object.assign(this, { title, options }));
    }
    Web.permission = "granted";
    const scope = { Notification: Web, focus: vi.fn() };
    desktopNotifier(scope)?.(shown);
    expect(made[0]).toMatchObject({ title: shown.title, options: { body: shown.body, data: shown.data } });
    made[0]?.onclick?.();
    expect(scope.focus).toHaveBeenCalled();
  });

  it("cannot notify on a phone, in a browser not yet allowed, or with a shell lacking a notifier", () => {
    expect(desktopNotifier({})).toBeNull();
    expect(desktopNotifier(undefined)).toBeNull();
    expect(desktopNotifier({ Notification: Object.assign(function Web() {}, { permission: "default" }) })).toBeNull();
    expect(desktopNotifier({ paseoDesktop: { notification: {} } })).toBeNull();
    const hostile = Object.defineProperty({}, "paseoDesktop", { get: () => { throw new Error("no"); } });
    expect(desktopNotifier(hostile)).toBeNull();
  });
});

describe("windowFocused and pageVisible", () => {
  it("read the document, and say no without one", () => {
    expect(windowFocused({ document: { hasFocus: () => true } })).toBe(true);
    expect(windowFocused({ document: { hasFocus: () => { throw new Error("no"); } } })).toBe(false);
    expect(windowFocused({})).toBe(false);
    expect(pageVisible({ document: { visibilityState: "visible" } })).toBe(true);
    expect(pageVisible({ document: { visibilityState: "hidden" } })).toBe(false);
    expect(pageVisible({})).toBe(false);
  });
});

describe("toastText", () => {
  it("joins the title and the body", () => {
    expect(toastText(shown)).toBe("NA-1 is ready to accept: Drafts sync.");
    expect(toastText({ title: "NA-1 stalled", body: "" })).toBe("NA-1 stalled");
  });
});
