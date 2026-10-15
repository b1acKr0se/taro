/**
 * Trimming a Taro owner's or subagent's starting context at launch, and the watch on what it then
 * reaches for (TR-139; the lists and rules are `shared/agent-trim.ts`). The tools come off through
 * Paseo's `agent.create` hook, which Paseo stores with the agent and reapplies on resume; the skills
 * through the working directory's settings file, as `agent.session_open` can change only env.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import {
  contextRecord,
  firstRequestTokens,
  HIDDEN_SKILLS,
  isClaudeProvider,
  isTrimmedLaunch,
  STARTING_CONTEXT_LIMIT,
  toolMissRecord,
  toolMisses,
  withTrimmedTools,
} from "../shared/agent-trim";
import { withSkillsOff } from "../shared/claude-settings";
import { isSubagentRole } from "../shared/project";
import { statePath } from "./data-dir";
import { isInside } from "./environment";
import { readJsonIfPresent, writeTextAtomically } from "./files";
import type { PaseoAgent } from "./host-types";
import { mergeLocalSettings } from "./local-settings";
import { projectPaths, projectsDirectory } from "./projects";
import { serialized } from "./serialize";
import { claudeConfigDirectory, findTranscript } from "./session-cost";
import type { Stats } from "./stats";
import { appendTicketNote } from "./tickets";

interface CreateRequest {
  config: { provider: string; cwd: string; providerOptions?: Record<string, unknown> };
  env?: Record<string, string>;
}

/** The request with the trimmed tools disallowed and the skills turned off, or null for an agent Taro leaves as it is. */
export async function trimAgentLaunch<Request extends CreateRequest>(request: Request): Promise<Request | null> {
  const inManagerHome = isInside(await projectsDirectory(), request.config.cwd);
  if (!isTrimmedLaunch({ provider: request.config.provider, env: request.env, inManagerHome })) return null;
  await trimmingStartedAt();
  const skills = await mergeLocalSettings(request.config.cwd, "skill overrides", (current) => withSkillsOff(current, HIDDEN_SKILLS)).catch((error: unknown) => {
    console.warn(`[taro] could not turn skills off in ${request.config.cwd}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (skills !== null) console.log(`[taro] ${skills}`);
  return { ...request, config: { ...request.config, providerOptions: withTrimmedTools(request.config.providerOptions) } };
}

const MARKER = "context-trim.json";

/**
 * When this plugin first trimmed a launch: agents created before it started with every tool, so
 * the watch leaves them alone. Written once, read from disk after that.
 */
export function trimmingStartedAt(): Promise<string> {
  return serialized(`state:${MARKER}`, async () => {
    const stored = (await readJsonIfPresent(statePath(MARKER)).catch(() => null)) as { since?: unknown } | null;
    if (stored !== null && typeof stored.since === "string") return stored.since;
    const since = new Date().toISOString();
    await writeTextAtomically(statePath(MARKER), `${JSON.stringify({ since })}\n`);
    return since;
  });
}

async function trimmedSince(): Promise<string | null> {
  const stored = (await readJsonIfPresent(statePath(MARKER)).catch(() => null)) as { since?: unknown } | null;
  return stored !== null && typeof stored.since === "string" ? stored.since : null;
}

/** The first request's whole input in a transcript, read up to that line only. */
async function transcriptStartingContext(path: string): Promise<number | null> {
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const tokens = firstRequestTokens(line);
      if (tokens !== null) return tokens;
    }
    return null;
  } finally {
    lines.close();
  }
}

function recordTime(): string {
  return `${new Date().toISOString().slice(0, 16)}Z`;
}

type WatchedAgent = Pick<PaseoAgent, "id" | "provider" | "cwd"> & { createdAt?: string | null; persistence?: { sessionId?: unknown } | null };

/**
 * After a turn of a trimmed agent: a TOOL-MISS note for whatever it reached for that Taro removed,
 * and, once, its starting context into the stats with a CONTEXT note when that is over the limit.
 */
export async function watchTrimmedTurn(
  stats: Stats,
  agent: WatchedAgent,
  identity: { project: string; role: string; ticket: string | null },
  turn: readonly unknown[],
  configDirectory: string = claudeConfigDirectory(),
): Promise<void> {
  if (identity.ticket === null || !isClaudeProvider(agent.provider)) return;
  if (identity.role !== "owner" && !isSubagentRole(identity.role)) return;
  const since = await trimmedSince();
  if (since === null || typeof agent.createdAt !== "string" || agent.createdAt < since) return;
  const tracker = (await projectPaths(identity.project)).tracker;
  const who = { id: agent.id, role: identity.role };

  const misses = toolMisses(turn);
  if (misses.length > 0) await appendTicketNote(tracker, identity.ticket, toolMissRecord(recordTime(), who, misses));

  if (await stats.hasStartingContext(identity.project, identity.ticket, agent.id)) return;
  const sessionId = agent.persistence?.sessionId;
  if (typeof sessionId !== "string" || sessionId === "") return;
  const transcript = await findTranscript(configDirectory, agent.cwd, sessionId);
  if (transcript === null) return;
  const tokens = await transcriptStartingContext(transcript);
  if (tokens === null) return;
  const taken = await stats.startingContext(identity.project, identity.ticket, agent.id, tokens);
  if (taken && tokens > STARTING_CONTEXT_LIMIT) await appendTicketNote(tracker, identity.ticket, contextRecord(recordTime(), who, tokens));
}
