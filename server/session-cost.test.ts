import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claudeProjectFolder, costStateOf, findTranscript, sessionCost, transcriptCost } from "./session-cost";

const SESSION = "00000000-1111-4222-8333-444444444444";
const CWD = "/home/user/.paseo/worktrees/abc/notes-app";
let config = "";

function costState(total: number): string {
  return JSON.stringify({ type: "cost-state", sessionId: SESSION, totalCostUSD: total, modelUsage: { "claude-sonnet-5-5": { costUSD: total } } });
}

async function transcript(folder: string, lines: readonly string[]): Promise<string> {
  const directory = join(config, "projects", folder);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${SESSION}.jsonl`);
  await writeFile(path, `${lines.join("\n")}\n`);
  return path;
}

beforeEach(async () => {
  config = await mkdtemp(join(tmpdir(), "taro-session-cost-"));
});

afterEach(async () => {
  await rm(config, { recursive: true, force: true });
});

describe("costStateOf", () => {
  it("reads the total of a cost-state line only", () => {
    expect(costStateOf(costState(6.6253356))).toBe(6.6253356);
    expect(costStateOf(costState(0))).toBe(0);
    expect(costStateOf(JSON.stringify({ type: "assistant", message: { content: "the cost-state line" } }))).toBeNull();
    expect(costStateOf(JSON.stringify({ type: "cost-state", totalCostUSD: "6" }))).toBeNull();
    expect(costStateOf('{"type":"cost-state", broken')).toBeNull();
    expect(costStateOf("")).toBeNull();
  });
});

describe("transcriptCost", () => {
  it("is the last total: a resumed session writes a new one", async () => {
    const path = await transcript("x", [JSON.stringify({ type: "user" }), costState(9.59), JSON.stringify({ type: "assistant" }), costState(10.62), JSON.stringify({ type: "user" })]);
    expect(await transcriptCost(path)).toBe(10.62);
  });

  it("is null for a session that ended without saving one (a crash)", async () => {
    expect(await transcriptCost(await transcript("x", [JSON.stringify({ type: "user" })]))).toBeNull();
  });
});

describe("findTranscript", () => {
  it("names the folder as Claude Code does", () => {
    expect(claudeProjectFolder("/home/user/.paseo/worktrees/ab12/notes-app")).toBe("-home-user--paseo-worktrees-ab12-notes-app");
  });

  it("finds it where Claude Code files the working directory, or in any project folder", async () => {
    const expected = await transcript(claudeProjectFolder(CWD), [costState(1)]);
    expect(await findTranscript(config, CWD, SESSION)).toBe(expected);
    await rm(expected);
    const elsewhere = await transcript("-moved", [costState(1)]);
    expect(await findTranscript(config, CWD, SESSION)).toBe(elsewhere);
  });

  it("is null when there is none, no projects folder, or the session id is not one", async () => {
    expect(await findTranscript(config, CWD, SESSION)).toBeNull();
    await transcript("x", [costState(1)]);
    expect(await findTranscript(config, CWD, "../x/" + SESSION)).toBeNull();
  });
});

describe("sessionCost", () => {
  const agent = { provider: "claude", cwd: CWD, persistence: { provider: "claude", sessionId: SESSION } };

  it("reads a Claude agent's transcript", async () => {
    await transcript(claudeProjectFolder(CWD), [costState(2.5)]);
    expect(await sessionCost(agent as never, config)).toBe(2.5);
  });

  it("is null for another provider, no session, or no transcript", async () => {
    await transcript(claudeProjectFolder(CWD), [costState(2.5)]);
    expect(await sessionCost({ ...agent, provider: "codex" } as never, config)).toBeNull();
    expect(await sessionCost({ ...agent, persistence: null } as never, config)).toBeNull();
    expect(await sessionCost({ ...agent, persistence: { provider: "claude", sessionId: "0000" } } as never, config)).toBeNull();
  });
});
