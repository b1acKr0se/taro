import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaseoApi } from "./host-types";
import { sendFromPlugin } from "./send";
import { appendTicketNote, viewTicket } from "./tickets";
import { createUnlabelledAgents } from "./unlabelled-agents";

vi.mock("./send", () => ({ sendFromPlugin: vi.fn(async () => undefined) }));
vi.mock("./package-files", () => ({ TEMPLATES: { unlabelledAgent: "unlabelled" }, message: async (_name: string, values: Record<string, string>) => `unlabelled ${values.id}`, skillDirectory: async () => "/skill" }));
vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: "/tracker" }) }));
vi.mock("./tickets", () => ({ viewTicket: vi.fn(), appendTicketNote: vi.fn(async () => undefined) }));

const owner = { id: "owner-1", status: "idle", archivedAt: null, labels: { "taro.project": "ff", "taro.role": "owner", "taro.ticket": "FF-021" } };

function paseoWith(children: { id: string; labels: Record<string, string>; archivedAt?: string | null }[]) {
  const list = vi.fn(async (options: { filter?: { labels?: Record<string, string> } }) => {
    const labels = options.filter?.labels ?? {};
    const agents = labels["paseo.parent-agent-id"] === "owner-1" ? children : labels["taro.role"] === "owner" ? [owner] : [];
    return { entries: agents.map((agent) => ({ agent: { status: "running", title: "reviewer", archivedAt: null, ...agent } })), pageInfo: { hasMore: false, nextCursor: null } };
  });
  return { agents: { list } } as unknown as PaseoApi;
}

describe("createUnlabelledAgents", () => {
  beforeEach(() => {
    vi.mocked(sendFromPlugin).mockClear();
    vi.mocked(appendTicketNote).mockClear();
    vi.mocked(viewTicket).mockResolvedValue({ implementationNotes: null } as Awaited<ReturnType<typeof viewTicket>>);
  });

  it("tells the owner, notes the ticket and raises an alert, once per agent", async () => {
    const unlabelled = createUnlabelledAgents();
    const paseo = paseoWith([{ id: "57bc922c-0000", labels: { "paseo.parent-agent-id": "owner-1" } }]);
    expect(await unlabelled.sweep(paseo, ["ff"])).toBe(true);
    expect(sendFromPlugin).toHaveBeenCalledWith(paseo, "owner-1", "unlabelled 57bc922c-0000");
    expect(vi.mocked(appendTicketNote).mock.calls[0]?.[2]).toMatch(/^UNLABELLED .*57bc922c/);
    expect(unlabelled.alerts("ff").map((alert) => alert.id)).toEqual(["unlabelled-57bc922c-0000"]);

    vi.mocked(viewTicket).mockResolvedValue({ implementationNotes: vi.mocked(appendTicketNote).mock.calls[0]?.[2] ?? "" } as Awaited<ReturnType<typeof viewTicket>>);
    expect(await unlabelled.sweep(paseo, ["ff"])).toBe(false);
    expect(sendFromPlugin).toHaveBeenCalledTimes(1);
    expect(unlabelled.alerts("ff")).toHaveLength(1);
  });

  it("ignores a labelled subagent and keeps no alert", async () => {
    const unlabelled = createUnlabelledAgents();
    const paseo = paseoWith([{ id: "x", labels: { "paseo.parent-agent-id": "owner-1", "taro.project": "ff", "taro.role": "reviewer", "taro.ticket": "FF-021" } }]);
    expect(await unlabelled.sweep(paseo, ["ff"])).toBe(false);
    expect(sendFromPlugin).not.toHaveBeenCalled();
    expect(unlabelled.alerts("ff")).toEqual([]);
  });

  it("drops the alert once the agent is archived", async () => {
    const unlabelled = createUnlabelledAgents();
    await unlabelled.sweep(paseoWith([{ id: "57bc922c-0000", labels: { "paseo.parent-agent-id": "owner-1" } }]), ["ff"]);
    expect(await unlabelled.sweep(paseoWith([{ id: "57bc922c-0000", labels: { "paseo.parent-agent-id": "owner-1" }, archivedAt: "2026-11-08T10:00:00Z" }]), ["ff"])).toBe(true);
    expect(unlabelled.alerts("ff")).toEqual([]);
  });

  it("retries the warning when the send failed, since no note was written", async () => {
    const unlabelled = createUnlabelledAgents();
    const paseo = paseoWith([{ id: "57bc922c-0000", labels: { "paseo.parent-agent-id": "owner-1" } }]);
    vi.mocked(sendFromPlugin).mockRejectedValueOnce(new Error("busy"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await unlabelled.sweep(paseo, ["ff"]);
    expect(appendTicketNote).not.toHaveBeenCalled();
    expect(unlabelled.alerts("ff")[0]?.text).toContain("could not reach");
    await unlabelled.sweep(paseo, ["ff"]);
    expect(appendTicketNote).toHaveBeenCalledTimes(1);
    expect(unlabelled.alerts("ff")[0]?.text).toContain("has been told");
  });
});
