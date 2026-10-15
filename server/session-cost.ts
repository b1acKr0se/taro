/**
 * An archived agent's cost, from its Claude Code transcript (TR-097). Paseo keeps an agent's usage
 * only in memory, so after a daemon restart it no longer knows what an archived agent cost; Claude
 * Code ends each session's transcript with a `cost-state` line holding the session's running total,
 * written when its process exits. A process that crashed or was killed may never write one.
 */
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { PaseoAgent } from "./host-types";

/** The session's total cost on a transcript line, or null when the line is not a `cost-state` entry. */
export function costStateOf(line: string): number | null {
  if (!line.includes('"cost-state"')) return null;
  try {
    const entry = JSON.parse(line) as { type?: unknown; totalCostUSD?: unknown };
    return entry.type === "cost-state" && typeof entry.totalCostUSD === "number" && Number.isFinite(entry.totalCostUSD) ? entry.totalCostUSD : null;
  } catch {
    return null;
  }
}

/** The last `cost-state` total in a transcript (a resumed session writes a new, higher one), or null. */
export async function transcriptCost(path: string): Promise<number | null> {
  // Streamed: an owner's transcript can pass a hundred megabytes.
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let cost: number | null = null;
  for await (const line of lines) cost = costStateOf(line) ?? cost;
  return cost;
}

/** Claude Code's folder for a working directory's sessions: every character but letters and digits becomes `-`. */
export function claudeProjectFolder(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeConfigDirectory(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (found) => found.isFile(),
    () => false,
  );
}

/** The transcript of `sessionId`: where Claude Code files it for `cwd`, else in whichever project folder has it. */
export async function findTranscript(configDirectory: string, cwd: string, sessionId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return null;
  const projects = join(configDirectory, "projects");
  const expected = join(projects, claudeProjectFolder(cwd), `${sessionId}.jsonl`);
  if (await isFile(expected)) return expected;
  const folders = await readdir(projects).catch(() => [] as string[]);
  for (const folder of folders) {
    const candidate = join(projects, folder, `${sessionId}.jsonl`);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

/** What a Claude agent cost by its transcript; null for another provider, a missing transcript, or one without a total. */
export async function sessionCost(agent: Pick<PaseoAgent, "provider" | "cwd" | "persistence">, configDirectory: string = claudeConfigDirectory()): Promise<number | null> {
  const sessionId = agent.persistence?.sessionId;
  if (agent.provider !== "claude" || typeof sessionId !== "string" || sessionId === "") return null;
  const path = await findTranscript(configDirectory, agent.cwd, sessionId);
  return path === null ? null : transcriptCost(path);
}
