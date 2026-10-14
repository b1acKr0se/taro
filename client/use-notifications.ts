/**
 * The window's half of Taro's notifications (TR-059): it polls what entered Needs you, shows each as a
 * desktop notification while the window is behind others, or a toast while it is in front, and tells
 * the server it is in use, so the phone is not pushed as well. A phone shows nothing here: its pushes
 * come from the server.
 */
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef } from "react";

import { pollNotifications } from "../shared/contracts";
import { PRESENCE_MS } from "../shared/notifications";
import { desktopNotifier, pageVisible, toastText, windowFocused } from "./desktop-notifications";

const POLL_MS = 5_000;
const USE_EVENTS = ["pointerdown", "keydown", "mousemove", "wheel", "focus"];

/** One per loaded bundle: a reconnect loads it again and starts a new one, which is fine. */
const CLIENT_ID = `window-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function useNeedsYouNotifications(): void {
  const poll = useRpc(pollNotifications);
  const toast = useToast();
  // The poll outlives renders (the sidebar redraws every few seconds); it reads the latest of both.
  const pollRef = useRef(poll);
  const toastRef = useRef(toast);
  pollRef.current = poll;
  toastRef.current = toast;

  useEffect(() => {
    const scope: unknown = globalThis;
    const listen = (scope as { addEventListener?: unknown }).addEventListener;
    const unlisten = (scope as { removeEventListener?: unknown }).removeEventListener;
    let usedAt = windowFocused(scope) ? Date.now() : 0;
    const used = () => {
      usedAt = Date.now();
    };
    if (typeof listen === "function") USE_EVENTS.map((name) => listen.call(scope, name, used, { passive: true }));

    let after = -1;
    let live = true;
    let polling = false;
    const tick = () => {
      if (polling) return;
      polling = true;
      const show = desktopNotifier(scope);
      const active = show !== null && pageVisible(scope) && Date.now() - usedAt <= PRESENCE_MS;
      pollRef
        .current({ clientId: CLIENT_ID, active, after })
        .then((result) => {
          if (!live) return;
          after = result.seq;
          if (show === null) return;
          const inFront = windowFocused(scope);
          result.notifications.map((notification) => (inFront ? toastRef.current.show(toastText(notification), { variant: "warning" }) : show(notification)));
        })
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
      if (typeof unlisten === "function") USE_EVENTS.map((name) => unlisten.call(scope, name, used));
    };
  }, []);
}
