import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readReplacingProviders } from "./provider-steering";
import { agentBrief } from "./summaries";
import type { PaseoAgent } from "./host-types";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "provider-steering-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("readReplacingProviders", () => {
  it("reads Paseo's config, and again once it changes", async () => {
    const config = join(directory, "config.json");
    await writeFile(config, JSON.stringify({ agents: { providers: { gemini: { extends: "acp" } } } }));
    expect((await readReplacingProviders(config)).has("gemini")).toBe(true);
    await writeFile(config, JSON.stringify({ agents: { providers: { kimi2: { extends: "kimi" } } } }));
    await utimes(config, new Date(), new Date(Date.now() + 5_000));
    const replacing = await readReplacingProviders(config);
    expect([replacing.has("gemini"), replacing.has("kimi2")]).toEqual([false, true]);
  });

  it("falls back to the built-in list when the config is missing or broken", async () => {
    expect((await readReplacingProviders(join(directory, "missing.json"))).has("copilot")).toBe(true);
    const broken = join(directory, "broken.json");
    await writeFile(broken, "{ not json");
    expect([...(await readReplacingProviders(broken))].sort()).toEqual(["acp", "copilot", "cursor", "kimi", "kiro", "traecli"]);
  });
});

describe("agentBrief", () => {
  it("says whether the agent's provider takes a message mid-turn", () => {
    const agent = { id: "agent-1", provider: "gemini", status: "running", updatedAt: "2026-10-14T18:00:00Z", pendingPermissions: [] } as unknown as PaseoAgent;
    expect(agentBrief(agent, new Set(["gemini"])).steers).toBe(false);
    expect(agentBrief({ ...agent, provider: "claude" } as PaseoAgent, new Set(["gemini"])).steers).toBe(true);
  });
});
