/**
 * Which icon and colour each ticket phase, status line and record kind is drawn with. Pure data
 * (plus a theme lookup) so the card, the Ticket tab and the timeline agree, and tests can read it.
 */
import type { PluginTheme } from "@getpaseo/plugin";

import type { ColumnMeta } from "../shared/board";
import type { StatusState } from "../shared/reports";

export type Tone = ColumnMeta["tone"];

export interface Look {
  icon: string;
  tone: Tone;
}

export function toneColor(theme: PluginTheme, tone: Tone): string {
  const colors = theme.colors;
  switch (tone) {
    case "accent":
      return colors.accent;
    case "success":
      return colors.statusSuccess;
    case "warning":
      return colors.statusWarning;
    case "danger":
      return colors.statusDanger;
    case "muted":
      return colors.foregroundMuted;
  }
}

const PHASES: Readonly<Record<string, Look>> = {
  Planning: { icon: "PencilRuler", tone: "accent" },
  "In Progress": { icon: "Hammer", tone: "accent" },
  Reviewing: { icon: "Eye", tone: "accent" },
  "Awaiting acceptance": { icon: "Hourglass", tone: "warning" },
  Blocked: { icon: "Ban", tone: "danger" },
  Done: { icon: "CircleCheck", tone: "success" },
};

/** A ticket status's badge; Queued, Ready, Cancelled and anything unknown are a muted circle. */
export function phaseLook(status: string): Look {
  return PHASES[status] ?? { icon: "Circle", tone: "muted" };
}

const STATUS_STATES: Readonly<Record<StatusState, Look>> = {
  working: { icon: "Loader", tone: "muted" },
  waiting: { icon: "Clock", tone: "muted" },
  blocked: { icon: "CircleAlert", tone: "danger" },
  done: { icon: "Check", tone: "success" },
  failed: { icon: "X", tone: "danger" },
};

/** The icon before an owner's last status line. */
export function statusStateLook(state: StatusState): Look {
  return STATUS_STATES[state];
}

const RECORD_KINDS: Readonly<Record<string, Look>> = {
  MILESTONE: { icon: "Flag", tone: "accent" },
  APPROVAL: { icon: "ThumbsUp", tone: "success" },
  REVIEW: { icon: "ShieldCheck", tone: "accent" },
  FINAL: { icon: "PackageCheck", tone: "success" },
  ACCEPTANCE: { icon: "CircleCheck", tone: "success" },
  RECOVERY: { icon: "LifeBuoy", tone: "warning" },
  EXECUTION: { icon: "Play", tone: "muted" },
  ANSWER: { icon: "MessageSquare", tone: "muted" },
  HANDOFF: { icon: "ArrowRightLeft", tone: "muted" },
  "DISPATCH-INTENT": { icon: "Send", tone: "muted" },
  "SCOPE-CHANGE": { icon: "Pencil", tone: "accent" },
};

/** A record's row on the milestone timeline; a kind nobody planned for is a muted dot. */
export function recordKindLook(kind: string): Look {
  return RECORD_KINDS[kind] ?? { icon: "Dot", tone: "muted" };
}
