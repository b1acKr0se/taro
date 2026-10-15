/** The words of the crash card (TR-132), apart from its layout so they can be tested. Pure. */
import { deviceLine, type CrashReport, type TrailStep } from "../shared/crash-trail";
import { relativeTime } from "./format";

export interface CrashReportText {
  heading: string;
  /** When and where: "2h ago (09:12) · ios 18.2 · phone · 390×844". */
  when: string;
  cause: string;
  steps: string[];
  file: string;
}

const STEP_LABELS: Record<TrailStep["kind"], string> = {
  launch: "started",
  screen: "showed",
  press: "pressed",
  keyboard: "keyboard",
  app: "app",
};

function clock(iso: string, seconds: boolean): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return "";
  const parts = [time.getHours(), time.getMinutes(), ...(seconds ? [time.getSeconds()] : [])];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

function heading(report: CrashReport): string {
  if (report.error === null) return "The app stopped unexpectedly";
  if (report.error.source === "fatal") return "The app crashed";
  // The app's own handlers see Paseo's errors too; only a Taro surface's boundary is surely Taro's.
  return report.error.source === "boundary" ? "Taro hit an error" : "The app hit an error";
}

export function crashReportText(report: CrashReport, now: number): CrashReportText {
  const ago = relativeTime(report.at, now);
  const at = clock(report.at, false);
  const when = [ago === "" ? at : `${ago} (${at})`, deviceLine(report.device)].filter((part) => part !== "").join(" · ");
  const cause =
    report.error === null
      ? "The app closed while in use, without an error Taro could see: a native crash, the system ending the app, or the app closed while it could not reach this host."
      : `${report.error.where === "app" ? "An error" : `An error in the ${report.error.where}`}: ${report.error.message}`;
  return {
    heading: heading(report),
    when,
    cause,
    steps: report.steps.map((step) => `${clock(step.at, true)}  ${STEP_LABELS[step.kind]} ${step.what}`.trimEnd()),
    file: report.file,
  };
}
