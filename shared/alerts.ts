/**
 * What a board alert is called, on its card and in its notification (TR-064). Pure.
 */
import { QUEUED_ALERT_ID } from "./queue-check";
import { PROTECTION_ALERT_ID } from "./tracker-guard";

const HEADINGS: Readonly<Record<string, string>> = {
  headroom: "Threads running low",
  "manager-crashed": "Manager crashed",
  [PROTECTION_ALERT_ID]: "Tracker protected",
  [QUEUED_ALERT_ID]: "Queued with a free slot",
};

export function alertHeading(alertId: string): string {
  return HEADINGS[alertId] ?? "Needs you";
}

/** The alerts the user may dismiss: those that only report (a restored tracker, a queue the Manager left). */
export function dismissible(alertId: string): boolean {
  return alertId === PROTECTION_ALERT_ID || alertId === QUEUED_ALERT_ID;
}
