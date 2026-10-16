import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DENY_RULES, ruleReasons } from "../shared/permission-triage";
import { fetchLiveAgent } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { withoutNotes } from "./package-files";
import { triageAsk } from "./permission-triage";
import type { Stats } from "./stats";
import { appendTicketNote } from "./tickets";

vi.mock("./agents", () => ({ fetchLiveAgent: vi.fn() }));
vi.mock("./tickets", () => ({ appendTicketNote: vi.fn(async () => undefined) }));
vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: "/tracker" }) }));

const respond = vi.fn(async (_options: unknown) => undefined);
const paseo = { agents: { ref: () => ({ respondToPermission: respond }) } } as unknown as PaseoApi;
const asker = { id: "agent-1", cwd: "/tmp/worktrees/tr-1" };

function liveAgent(labels: Record<string, string>, currentModeId: string | null = "bypassPermissions"): PaseoAgent {
  return { id: "agent-1", title: "Owner TR-1", labels, currentModeId } as unknown as PaseoAgent;
}

const owner = { "taro.project": "taro", "taro.role": "owner", "taro.ticket": "TR-1" };
const bash = (command: string) => ({ id: "permission-1", name: "Bash", kind: "tool", input: { command } });

function setUp(): { stats: Stats; counted: string[] } {
  const counted: string[] = [];
  const stats = { count: async (_project: string, ticket: string, field: string) => void counted.push(`${ticket}:${field}`) } as unknown as Stats;
  return { stats, counted };
}

describe("triageAsk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchLiveAgent).mockResolvedValue(liveAgent(owner));
  });

  it("allows a safe removal, records it on the ticket and counts nothing", async () => {
    const { stats, counted } = setUp();
    expect(await triageAsk(paseo, stats, asker, bash("rm -rf -- /tmp/notes-app.Ab12Cd"))).toBe("allow");
    expect(respond).toHaveBeenCalledWith({ requestId: "permission-1", response: { behavior: "allow" } });
    const [tracker, ticket, record] = vi.mocked(appendTicketNote).mock.calls[0] ?? [];
    expect([tracker, ticket]).toEqual(["/tracker", "TR-1"]);
    expect(record).toMatch(/^PERMISSION \S+Z — owner agent-1 asked to run `rm -rf -- \/tmp\/notes-app.Ab12Cd`; the plugin allowed \(rule scratch-or-worktree: \/tmp\/notes-app.Ab12Cd\), without asking the user\.$/);
    expect(counted).toEqual([]);
  });

  it("denies a wrong removal with the rule's reason, records it and counts it as a breach", async () => {
    const { stats, counted } = setUp();
    expect(await triageAsk(paseo, stats, asker, bash("rm -rf -- /TR-140"))).toBe("deny");
    const response = (respond.mock.calls[0]?.[0] as { response: { behavior: string; interrupt: boolean; message: string } }).response;
    expect(response).toMatchObject({ behavior: "deny", interrupt: false });
    expect(response.message).toContain("rule `top-level`");
    expect(response.message).toContain("it would remove /TR-140, a folder directly under `/`.");
    expect(response.message).toMatch(/\/skill\/reference\/shell\.md says/);
    expect(response.message).not.toMatch(/\{\{|<!--/);
    expect(vi.mocked(appendTicketNote).mock.calls[0]?.[2]).toContain("the plugin denied (rule top-level: /TR-140)");
    expect(counted).toEqual(["TR-1:permissionDenials"]);
  });

  it("leaves the ask to the user when the rules do not decide it", async () => {
    const { stats } = setUp();
    expect(await triageAsk(paseo, stats, asker, bash("cd /tmp/x && rm -rf sub/*"))).toBeNull();
    expect(await triageAsk(paseo, stats, asker, { id: "p", name: "AskUserQuestion", kind: "question", input: {} })).toBeNull();
    expect(respond).not.toHaveBeenCalled();
    expect(appendTicketNote).not.toHaveBeenCalled();
  });

  it("leaves agents alone that are not Taro's or not in bypass mode", async () => {
    const { stats } = setUp();
    vi.mocked(fetchLiveAgent).mockResolvedValueOnce(liveAgent({}));
    expect(await triageAsk(paseo, stats, asker, bash("rm -rf /"))).toBeNull();
    vi.mocked(fetchLiveAgent).mockResolvedValueOnce(liveAgent(owner, "default"));
    expect(await triageAsk(paseo, stats, asker, bash("rm -rf /"))).toBeNull();
    vi.mocked(fetchLiveAgent).mockResolvedValueOnce(null);
    expect(await triageAsk(paseo, stats, asker, bash("rm -rf /"))).toBeNull();
    expect(respond).not.toHaveBeenCalled();
  });

  it("records nothing when the user answered first", async () => {
    const { stats, counted } = setUp();
    respond.mockRejectedValueOnce(new Error("no pending permission"));
    expect(await triageAsk(paseo, stats, asker, bash("rm -rf /"))).toBeNull();
    expect(appendTicketNote).not.toHaveBeenCalled();
    expect(counted).toEqual([]);
  });

  it("logs a ticketless agent's decision without a ticket note", async () => {
    const { stats, counted } = setUp();
    vi.mocked(fetchLiveAgent).mockResolvedValueOnce(liveAgent({ "taro.project": "taro", "taro.role": "manager" }));
    expect(await triageAsk(paseo, stats, asker, bash("rm -rf /"))).toBe("deny");
    expect(appendTicketNote).not.toHaveBeenCalled();
    expect(counted).toEqual([]);
  });
});

describe("permission-rules.md", () => {
  it("gives every deny rule its reason", async () => {
    const reasons = ruleReasons(withoutNotes(await readFile(join(import.meta.dirname, "..", "templates", "permission-rules.md"), "utf8")));
    expect(Object.keys(reasons).sort()).toEqual([...DENY_RULES].sort());
  });
});
