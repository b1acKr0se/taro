import { describe, expect, it, vi } from "vitest";

import { listTaroAgents } from "./agents";
import type { PaseoApi } from "./host-types";

function fakePaseo(agents: { id: string; archivedAt: string | null }[]) {
  const list = vi.fn(async () => ({ entries: agents.map((agent) => ({ agent })), pageInfo: { hasMore: false, nextCursor: null } }));
  return { paseo: { agents: { list } } as unknown as PaseoApi, list };
}

describe("listTaroAgents", () => {
  it("asks Paseo for archived agents only when told to, since Paseo leaves them out by default", async () => {
    const { paseo, list } = fakePaseo([]);
    await listTaroAgents(paseo, { "taro.project": "p" });
    await listTaroAgents(paseo, { "taro.project": "p" }, { includeArchived: true });
    expect(list.mock.calls.map((call) => (call as unknown as [{ filter: Record<string, unknown> }])[0].filter)).toEqual([
      { labels: { "taro.project": "p" } },
      { labels: { "taro.project": "p" }, includeArchived: true },
    ]);
  });

  it("drops archived agents unless they were asked for", async () => {
    const agents = [
      { id: "live", archivedAt: null },
      { id: "gone", archivedAt: "2026-10-13T13:00:00Z" },
    ];
    expect((await listTaroAgents(fakePaseo(agents).paseo, {})).map((agent) => agent.id)).toEqual(["live"]);
    expect((await listTaroAgents(fakePaseo(agents).paseo, {}, { includeArchived: true })).map((agent) => agent.id)).toEqual(["live", "gone"]);
  });
});
