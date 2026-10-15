/**
 * Crash tracing in the app (TR-132): the app's own error handlers, its foreground and keyboard events,
 * and a boundary around every surface Taro adds feed the recorder (`crash-recorder.ts`); any mounted
 * surface lends its RPC to send the trail. Native crashes are not seen here: the trail on the host
 * shows where the app was when it stopped.
 */
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useRef, type ComponentType } from "react";
import { AppState, Dimensions, Keyboard, Platform } from "react-native";

import { reportTrail } from "../shared/contracts";
import type { Device } from "../shared/crash-trail";
import { crashRecorder, type TrailSend } from "./crash-recorder";
import { ErrorBoundary } from "./error-boundary";

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsShape {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
}

function errorUtils(): ErrorUtilsShape | null {
  const utils: unknown = Reflect.get(globalThis, "ErrorUtils");
  if (typeof utils !== "object" || utils === null) return null;
  const { getGlobalHandler, setGlobalHandler } = utils as Partial<ErrorUtilsShape>;
  return typeof getGlobalHandler === "function" && typeof setGlobalHandler === "function" ? (utils as ErrorUtilsShape) : null;
}

/** The part of the web page's window used here (the client has no DOM types). */
interface PageEvents {
  addEventListener(type: string, listener: (event: { error?: unknown; message?: unknown; reason?: unknown }) => void): void;
  removeEventListener(type: string, listener: (event: { error?: unknown; message?: unknown; reason?: unknown }) => void): void;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function desktopPlatform(): string {
  const shell: unknown = Reflect.get(globalThis, "paseoDesktop");
  return typeof shell === "object" && shell !== null ? text((shell as { platform?: unknown }).platform) : "";
}

export function deviceNow(): Device {
  const constants: Record<string, unknown> = (Platform as { constants?: Record<string, unknown> }).constants ?? {};
  let model = "";
  if (Platform.OS === "android") model = [text(constants.Brand), text(constants.Model)].filter((part) => part !== "").join(" ");
  else if (Platform.OS === "ios") model = text(constants.interfaceIdiom);
  else model = Reflect.get(globalThis, "paseoDesktop") === undefined ? "browser" : "desktop";
  const { width, height } = Dimensions.get("window");
  const size = typeof width === "number" && typeof height === "number" ? `${Math.round(width)}×${Math.round(height)}` : "";
  return {
    platform: Platform.OS.slice(0, 20),
    // The web reports a placeholder version; the desktop shell names its operating system.
    os: (Platform.OS === "web" ? desktopPlatform() : text(Platform.Version)).slice(0, 40),
    model: model.slice(0, 60),
    window: size.slice(0, 20),
  };
}

/** A step in the trail; never throws. */
export function crashStep(kind: "screen" | "press", what: string): void {
  try {
    crashRecorder().step(kind, what);
  } catch {
    // Tracing never adds a failure of its own.
  }
}

/**
 * Starts tracing for this evaluation of the bundle; the returned function stops it when the app
 * unloads the plugin. A handler another code installed after ours stays, with ours inside it quiet.
 */
export function startCrashTrail(): () => void {
  const stops: (() => void)[] = [];
  let active = true;
  try {
    const recorder = crashRecorder();
    if (recorder.fresh) {
      const device = deviceNow();
      recorder.step("launch", `${device.platform} ${device.os} ${device.model}`);
    }

    const utils = errorUtils();
    if (utils !== null) {
      const previous = utils.getGlobalHandler();
      const handler: GlobalHandler = (error, isFatal) => {
        try {
          if (active) recorder.error(isFatal === true ? "fatal" : "error", "app", error);
        } catch {
          // The app's own handler runs whatever happens here.
        }
        previous(error, isFatal);
      };
      utils.setGlobalHandler(handler);
      stops.push(() => {
        if (utils.getGlobalHandler() === handler) utils.setGlobalHandler(previous);
      });
    }

    // The web and the desktop app: their window reports errors and unhandled rejections. The phone's
    // rejection tracker is the app's and is not replaced; a rejection does not end the app there.
    const page: unknown = Reflect.get(globalThis, "window");
    if (Platform.OS === "web" && typeof page === "object" && page !== null && typeof (page as Partial<PageEvents>).addEventListener === "function") {
      const target = page as PageEvents;
      const onError = (event: { error?: unknown; message?: unknown }) => recorder.error("error", "app", event.error ?? event.message);
      const onRejection = (event: { reason?: unknown }) => recorder.error("rejection", "app", event.reason);
      target.addEventListener("error", onError);
      target.addEventListener("unhandledrejection", onRejection);
      stops.push(() => {
        target.removeEventListener("error", onError);
        target.removeEventListener("unhandledrejection", onRejection);
      });
    }

    if (Platform.OS !== "web") recorder.setState(AppState.currentState === "background" ? "background" : "foreground");
    const appState = AppState.addEventListener("change", (next) => {
      recorder.step("app", next);
      // "inactive" comes first on iOS when the app is being left, and may be all that is sent in time.
      recorder.setState(next === "active" ? "foreground" : "background");
    });
    stops.push(() => appState.remove());
    const shown = Keyboard.addListener("keyboardDidShow", () => recorder.step("keyboard", "shown"));
    const hidden = Keyboard.addListener("keyboardDidHide", () => recorder.step("keyboard", "hidden"));
    stops.push(() => {
      shown.remove();
      hidden.remove();
    });
  } catch (error) {
    console.warn("[taro] crash tracing did not start", error);
  }
  return () => {
    active = false;
    stops.map((stop) => {
      try {
        stop();
      } catch {
        // Stopping the rest matters more.
      }
      return null;
    });
  };
}

/** Lends this surface's RPC to the recorder while it is mounted. */
function useCrashSender(): void {
  const send = useRpc(reportTrail);
  const latest = useRef(send);
  latest.current = send;
  useEffect(() => {
    const sender: TrailSend = async (report) => {
      await latest.current({ ...report, device: deviceNow() });
    };
    crashRecorder().setSender(sender);
    return () => crashRecorder().clearSender(sender);
  }, []);
}

/** A surface Taro adds to the app, its failures recorded before Paseo's boundary shows them. */
export function withCrashTrail<Props extends object>(label: string, Surface: ComponentType<Props>): ComponentType<Props> {
  return function CrashTrailSurface(props: Props) {
    useCrashSender();
    return (
      <ErrorBoundary label={label}>
        <Surface {...props} />
      </ErrorBoundary>
    );
  };
}
