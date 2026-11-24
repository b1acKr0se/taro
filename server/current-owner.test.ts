// A subagent's report goes to its ticket's owner: a live one first, else the newest one Paseo freed
// after an idle hour (a message loads it again), never none while an owner exists.
import { describe, expect, it, vi } from "vitest";

import { listTaroAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { currentOwner } from "./supervision";

vi.mock("./agents", async (original) => ({ ...(await original<typeof import("./agents")>()), listTaroAgents: vi.fn(), fetchLiveAgent: vi.fn(async () => null) }));

const owner = (id: string, status: string, updatedAt: string) => ({ id, status, updatedAt, labels: {} }) as unknown as PaseoAgent;
const paseo = {} as unknown as PaseoApi;

describe("currentOwner", () => {
  it("prefers a live owner, then the newest closed one", async () => {
    vi.mocked(listTaroAgents).mockResolvedValue([owner("old", "closed", "2026-01-01T00:00:00Z"), owner("new", "closed", "2026-01-02T00:00:00Z"), owner("live", "idle", "2026-01-01T12:00:00Z")]);
    expect((await currentOwner(paseo, "demo", "DM-1", null))?.id).toBe("live");
    vi.mocked(listTaroAgents).mockResolvedValue([owner("old", "closed", "2026-01-01T00:00:00Z"), owner("new", "closed", "2026-01-02T00:00:00Z")]);
    expect((await currentOwner(paseo, "demo", "DM-1", null))?.id).toBe("new");
    vi.mocked(listTaroAgents).mockResolvedValue([]);
    expect(await currentOwner(paseo, "demo", "DM-1", null)).toBeNull();
  });
});
