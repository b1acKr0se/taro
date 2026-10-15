import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backfillCosts, recordArchivedUsage } from "./cost-recording";
import type { PaseoApi } from "./host-types";
import { claudeProjectFolder } from "./session-cost";
import { Stats } from "./stats";

const SESSION = "00000000-1111-4222-8333-444444444444";
const CWD = "/home/user/.paseo/worktrees/ab12/notes-app";
const labels = { "taro.project": "notes-app", "taro.role": "implementer", "taro.ticket": "NA-1.1" };
let home = "";

function archivedAgent(extra: object = {}) {
  return { id: "sub-1", provider: "claude", cwd: CWD, labels, archivedAt: "2026-10-15T00:00:00Z", persistence: { provider: "claude", sessionId: SESSION }, ...extra };
}

/** Paseo as the plugin sees it: `list` answers with these agents, `ref(id).refresh()` with the one of that id. */
function fakePaseo(agents: object[]) {
  const list = vi.fn(async () => ({ entries: agents.map((agent) => ({ agent })), pageInfo: { hasMore: false, nextCursor: null } }));
  const ref = (agentId: string) => ({ refresh: async () => {
    const agent = agents.find((candidate) => (candidate as { id: string }).id === agentId);
    return agent === undefined ? null : { agent };
  } });
  return { paseo: { agents: { list, ref } } as unknown as PaseoApi, list };
}

async function recorded(stats: Stats, ticket: string) {
  return (await stats.all("notes-app")).find((entry) => entry.ticket === ticket)?.agents["sub-1"];
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-cost-recording-"));
  vi.stubEnv("PASEO_HOME", join(home, "paseo"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(home, "claude"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe("recordArchivedUsage", () => {
  it("records an archived agent's last usage on its ticket and its parent", async () => {
    const stats = new Stats();
    await stats.turnEnded("notes-app", "NA-1.1", { id: "sub-1", role: "implementer", model: null, title: null }, 1_000);
    const { paseo } = fakePaseo([archivedAgent({ lastUsage: { totalCostUsd: 0.8, contextWindowUsedTokens: 12 } })]);
    await recordArchivedUsage(paseo, stats, "sub-1");
    expect(await recorded(stats, "NA-1.1")).toMatchObject({ costUsd: 0.8, contextTokens: 12 });
    expect(await recorded(stats, "NA-1")).toMatchObject({ costUsd: 0.8, contextTokens: 12 });
  });

  it("does nothing for an agent Paseo does not know or one outside Taro", async () => {
    const stats = new Stats();
    const { paseo } = fakePaseo([archivedAgent({ id: "plain", labels: {}, lastUsage: { totalCostUsd: 1 } })]);
    await recordArchivedUsage(paseo, stats, "missing");
    await recordArchivedUsage(paseo, stats, "plain");
    expect(await stats.all(null)).toEqual([]);
  });
});

describe("backfillCosts", () => {
  it("fills an archived agent's cost from its transcript, on child and parent, asking Paseo for archived agents", async () => {
    const folder = join(home, "claude", "projects", claudeProjectFolder(CWD));
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `${SESSION}.jsonl`), `${JSON.stringify({ type: "user" })}\n${JSON.stringify({ type: "cost-state", totalCostUSD: 2.75 })}\n`);
    const stats = new Stats();
    await stats.turnEnded("notes-app", "NA-1.1", { id: "sub-1", role: "implementer", model: null, title: null }, 1_000);
    await stats.turnEnded("notes-app", "NA-1.1", { id: "gone", role: "implementer", model: null, title: null }, 1_000);
    const { paseo, list } = fakePaseo([archivedAgent()]);

    expect(await backfillCosts(paseo, stats, ["notes-app"])).toMatchObject({ filled: 1, missing: 1 });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ filter: { labels: { "taro.project": "notes-app" }, includeArchived: true } }));
    expect(await recorded(stats, "NA-1.1")).toMatchObject({ costUsd: 2.75 });
    expect(await recorded(stats, "NA-1")).toMatchObject({ costUsd: 2.75 });
    const stored = JSON.parse(await readFile(join(home, "paseo", "plugin-data", "taro", "state", "stats.json"), "utf8"));
    expect(stored.tickets["notes-app:NA-1.1"].agents.gone.costUsd).toBeNull();
  });

  it("leaves the backfill to retry at the next start when Paseo cannot list agents", async () => {
    const stats = new Stats();
    await stats.turnEnded("notes-app", "NA-1.1", { id: "sub-1", role: "implementer", model: null, title: null }, 1_000);
    const paseo = { agents: { list: async () => Promise.reject(new Error("disposed")) } } as unknown as PaseoApi;
    await expect(backfillCosts(paseo, stats, ["notes-app"])).rejects.toThrow("disposed");
    expect(await stats.backfillCosts(async () => 1)).toMatchObject({ filled: 1 });
  });
});
