/**
 * The live list (`live.json` in the plugin's state folder): for each project the board was built for, its
 * live agents and the keys of their open cards. `taro board` reads it to tell the live from what the
 * supervision record (`agents.json`) and `decisions.json` keep after an agent is archived. Whether an agent
 * lives is known to the daemon alone, so the plugin writes down what its board build saw.
 *
 * The board is built every 15 seconds by the notification check, Paseo's screen open or not, so the list
 * stays current without a sweep of its own. Rewritten when a project's entry changed, and otherwise at most once
 * a minute as a heartbeat: its `writtenAt` is when the list was last confirmed, so `taro board` can tell a list
 * a stopped daemon left behind from a quiet project.
 */
import { LIVE_LIST_VERSION, type LiveList, type LiveListEntry } from "../shared/board-text";
import { roleFromLabel, TARO_LABELS } from "../shared/project";
import type { AgentState } from "../shared/state";
import { statePath } from "./data-dir";
import { readJsonIfPresent, writeJsonAtomically } from "./files";
import type { PaseoAgent } from "./host-types";
import { serialized } from "./serialize";

export function liveListPath(): string {
  return statePath("live.json");
}

/** A project's entry, agents and keys sorted so an unchanged board compares equal. */
export function liveListEntry(
  project: string,
  agents: readonly PaseoAgent[],
  agentStates: Readonly<Record<string, Pick<AgentState, "lastStatus"> | undefined>>,
  openCardKeys: readonly string[],
  writtenAt: string,
): LiveListEntry {
  return {
    project,
    writtenAt,
    agents: agents
      .map((agent) => {
        const label = agent.labels[TARO_LABELS.role];
        const status = agentStates[agent.id]?.lastStatus ?? null;
        return {
          id: agent.id,
          role: roleFromLabel(label) ?? label ?? "agent",
          ticket: agent.labels[TARO_LABELS.ticket] ?? null,
          title: agent.title ?? null,
          state: status?.state ?? null,
          text: status?.text ?? null,
          at: status?.at ?? null,
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
    cardKeys: [...new Set(openCardKeys)].sort(),
  };
}

function sameContent(left: LiveListEntry, right: unknown): boolean {
  if (typeof right !== "object" || right === null) return false;
  const { writtenAt: _left, ...leftContent } = left;
  const { writtenAt: _right, ...rightContent } = right as Record<string, unknown>;
  return JSON.stringify(leftContent) === JSON.stringify(rightContent);
}

/** An unchanged entry is rewritten once its last write is this old, to show the plugin still builds boards. */
export const LIVE_LIST_HEARTBEAT_MS = 60_000;

function heartbeatDue(writtenAt: string, before: unknown): boolean {
  const last = typeof before === "object" && before !== null ? Date.parse(String((before as { writtenAt?: unknown }).writtenAt)) : Number.NaN;
  const now = Date.parse(writtenAt);
  return Number.isNaN(last) || (!Number.isNaN(now) && now - last >= LIVE_LIST_HEARTBEAT_MS);
}

/** Records the project's entry, atomically; returns whether the file was written. */
export function recordLiveList(entry: LiveListEntry): Promise<boolean> {
  return serialized("live-list", async () => {
    const path = liveListPath();
    const raw = await readJsonIfPresent(path).catch(() => null);
    const current: LiveList =
      typeof raw === "object" && raw !== null && (raw as LiveList).version === LIVE_LIST_VERSION && typeof (raw as LiveList).projects === "object" && (raw as LiveList).projects !== null
        ? (raw as LiveList)
        : { version: LIVE_LIST_VERSION, projects: {} };
    const before = current.projects[entry.project];
    if (sameContent(entry, before) && !heartbeatDue(entry.writtenAt, before)) return false;
    await writeJsonAtomically(path, { version: LIVE_LIST_VERSION, projects: { ...current.projects, [entry.project]: entry } });
    return true;
  });
}
