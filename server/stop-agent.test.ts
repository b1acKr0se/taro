/** The chat's stop button and Escape (TR-181): only a live Taro agent's turn is stopped, by its full id. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stopAgentTurn } from "../shared/contracts";
import { Actions } from "./actions";
import { fetchLiveAgent } from "./agents";
import { stopAgent } from "./cli";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", async (original) => ({ ...(await original<typeof import("./agents")>()), fetchLiveAgent: vi.fn() }));
vi.mock("./cli", async (original) => ({ ...(await original<typeof import("./cli")>()), stopAgent: vi.fn(async () => undefined) }));

const OWNER_ID = "3f2a9c1d-0000-4000-8000-000000000001";
const owner = { id: OWNER_ID, status: "running", title: "Owner", labels: { "taro.project": "notes-app", "taro.role": "owner", "taro.ticket": "NA-3" } } as unknown as PaseoAgent;
const stranger = { id: "7b1e0000-0000-4000-8000-000000000002", status: "running", title: "Mine", labels: {} } as unknown as PaseoAgent;
const actions = new Actions({} as PluginState, {} as Supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);

beforeEach(() => {
  vi.mocked(stopAgent).mockClear();
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => [owner, stranger].find((agent) => agent.id === id) ?? null);
});

describe("Actions.stop", () => {
  it("stops a live Taro agent by the full id Paseo returned", async () => {
    await actions.stop({} as PaseoApi, OWNER_ID);
    expect(vi.mocked(stopAgent).mock.calls).toEqual([[OWNER_ID]]);
  });

  it("refuses an agent Paseo no longer has, and never passes the input to `paseo stop` (a prefix or --all would match others)", async () => {
    for (const id of ["3f2a", "--all", "", "gone-agent"]) {
      await expect(actions.stop({} as PaseoApi, id)).rejects.toThrow("That agent is no longer running.");
    }
    expect(stopAgent).not.toHaveBeenCalled();
  });

  it("refuses an agent that is not Taro's", async () => {
    await expect(actions.stop({} as PaseoApi, stranger.id)).rejects.toThrow("That is not a Taro agent.");
    expect(stopAgent).not.toHaveBeenCalled();
  });

  it("surfaces `paseo stop` failing", async () => {
    vi.mocked(stopAgent).mockRejectedValueOnce(new Error("paseo stop failed: daemon unreachable"));
    await expect(actions.stop({} as PaseoApi, OWNER_ID)).rejects.toThrow("daemon unreachable");
  });

  it("has a valid RPC wire name", () => {
    expect(stopAgentTurn.name).toBe("taro.agent.stop");
  });
});
