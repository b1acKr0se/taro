/**
 * Showing a notification on the desktop (TR-059) the way Paseo's app shows its own (`sendOsNotification`
 * in its web bundle): through `window.paseoDesktop.notification.sendNotification`, the undocumented
 * object Paseo's desktop shell injects, which routes a click by the notification's `serverId`, `agentId`
 * and `workspaceId`; else the web `Notification` API once the user has allowed it. The phone has
 * neither (Taro's server pushes there). Every call is feature-detected and guarded, as with the shell's
 * window object (TR-054). Pure, apart from the scope it is given.
 */

export interface DesktopNotification {
  title: string;
  body: string;
  data: Record<string, string>;
}

export type ShowNotification = (notification: DesktopNotification) => void;

function read(object: unknown, name: string): unknown {
  if (typeof object !== "object" && typeof object !== "function") return undefined;
  if (object === null) return undefined;
  try {
    return (object as Record<string, unknown>)[name];
  } catch {
    return undefined;
  }
}

/** How this window can show a notification, or null when it cannot. Never throws. */
export function desktopNotifier(scope: unknown): ShowNotification | null {
  const notification = read(read(scope, "paseoDesktop"), "notification");
  const send = read(notification, "sendNotification");
  if (typeof send === "function") {
    return (shown) => {
      try {
        // It may answer with a promise, a plain value or nothing (TR-054); a rejection is dropped.
        void Promise.resolve(send.call(notification, shown)).catch(() => undefined);
      } catch {
        // A shell that throws shows nothing.
      }
    };
  }
  const Web = read(scope, "Notification");
  if (typeof Web !== "function" || read(Web, "permission") !== "granted") return null;
  return (shown) => {
    try {
      const made: unknown = new (Web as new (title: string, options: { body: string; data: Record<string, string> }) => unknown)(shown.title, { body: shown.body, data: shown.data });
      const focus = read(scope, "focus");
      if (typeof made === "object" && made !== null && typeof focus === "function") {
        (made as { onclick?: () => void }).onclick = () => {
          try {
            focus.call(scope);
          } catch {
            // Nothing to bring forward.
          }
        };
      }
    } catch {
      // A browser that refuses shows nothing.
    }
  };
}

function documentOf(scope: unknown): unknown {
  return read(scope, "document");
}

/** The window is in front with this page in it. */
export function windowFocused(scope: unknown): boolean {
  const document = documentOf(scope);
  const hasFocus = read(document, "hasFocus");
  if (typeof hasFocus !== "function") return false;
  try {
    return hasFocus.call(document) === true;
  } catch {
    return false;
  }
}

/** The page is showing (not a hidden tab or a minimised window). */
export function pageVisible(scope: unknown): boolean {
  return read(documentOf(scope), "visibilityState") === "visible";
}

/** What a toast says for a notification while the window is in front. */
export function toastText(notification: { title: string; body: string }): string {
  return notification.body === "" ? notification.title : `${notification.title}: ${notification.body}`;
}
