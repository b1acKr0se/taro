// TR-031: Accept records ACCEPTED on the ticket so the card says it is merging, except when the owner
// is told not to merge and to present again (a pull request without a recorded head or URL).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actions } from "./actions";
import { listTaroAgents } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { requireProjectConfig } from "./projects";
import type { Recovery } from "./recovery";
import { sendWithoutInterrupting } from "./send";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import { appendTicketNote, viewTicket } from "./tickets";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", async (original) => ({ ...(await original<typeof import("./agents")>()), listTaroAgents: vi.fn() }));
vi.mock("./projects", () => ({ listProjectConfigs: async () => [], projectPaths: async () => ({ tracker: "/tracker" }), requireProjectConfig: vi.fn() }));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn(), appendTicketNote: vi.fn(async () => undefined) }));
vi.mock("./evidence", () => ({ requireCompleteEvidence: async () => undefined }));
vi.mock("./send", () => ({ sendWithoutInterrupting: vi.fn(async () => undefined), sendFromPlugin: vi.fn(async () => undefined) }));
vi.mock("./package-files", async (original) => ({ ...(await original<typeof import("./package-files")>()), message: async (_template: string, values: Record<string, string>) => values.mergeInstruction ?? "" }));

const owner = { id: "owner-1", status: "idle", updatedAt: "2026-01-01T00:00:00Z", labels: { "taro.project": "demo", "taro.role": "owner", "taro.ticket": "DM-1" } } as unknown as PaseoAgent;
const head = "b".repeat(40);
let actions: Actions;

function config(parts: Record<string, unknown>) {
  vi.mocked(requireProjectConfig).mockResolvedValue({ project: "demo", baseBranch: "main", repoPath: "/repo", acceptAlsoMerges: true, delivery: "local-only", ...parts } as never);
}

function ticket(notes: string, labels: string[] = []) {
  vi.mocked(viewTicket).mockResolvedValue({ implementationNotes: notes, finalSummary: null, labels } as never);
}

function written(): string[] {
  return vi.mocked(appendTicketNote).mock.calls.map((call) => call[2]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTaroAgents).mockResolvedValue([owner]);
  actions = new Actions({} as PluginState, {} as Supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
});

describe("accept", () => {
  it("records ACCEPTED merging into the base branch for local-only delivery, after telling the owner", async () => {
    config({});
    ticket("");
    await actions.accept({} as PaseoApi, "demo", "DM-1");
    expect(vi.mocked(sendWithoutInterrupting)).toHaveBeenCalledOnce();
    expect(written()).toHaveLength(1);
    expect(written()[0]).toMatch(/^ACCEPTED \S+ — the user accepted; merging: into main$/);
  });

  it("records the pull request when its head and URL are recorded", async () => {
    config({ delivery: "pull-request" });
    ticket(`EXECUTION 2026-01-01T00:00Z — pr: https://example.test/o/r/pull/7, review-head: ${head}`);
    await actions.accept({} as PaseoApi, "demo", "DM-1");
    expect(written()[0]).toMatch(/merging: the pull request$/);
  });

  it("records nothing when the owner is told not to merge and to present again", async () => {
    config({ delivery: "pull-request" });
    ticket("EXECUTION 2026-01-01T00:00Z — pr: https://example.test/o/r/pull/7");
    await actions.accept({} as PaseoApi, "demo", "DM-1");
    expect(vi.mocked(sendWithoutInterrupting).mock.calls[0]?.[2]).toMatch(/^Do not merge/);
    expect(written()).toEqual([]);
  });

  it("records a plain acceptance for an investigation and when accepting does not merge", async () => {
    config({});
    ticket("", ["investigation"]);
    await actions.accept({} as PaseoApi, "demo", "DM-1");
    config({ acceptAlsoMerges: false });
    ticket("");
    await actions.accept({} as PaseoApi, "demo", "DM-1");
    expect(written().map((text) => text.replace(/^ACCEPTED \S+/, "ACCEPTED"))).toEqual(["ACCEPTED — the user accepted; merging: none", "ACCEPTED — the user accepted; merging: none"]);
  });
});
