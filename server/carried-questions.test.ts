// TR-136: when an owner is replaced (Relaunch, Resume after Pause, archived by hand), the questions
// the user had not answered go into the new owner's first message, and nothing else does.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { withdrawOpenDecisions, type StoredDecision } from "../shared/state";
import { Actions } from "./actions";
import type { PaseoAgent, PaseoApi } from "./host-types";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import type { TrackerWatch } from "./tracker-watch";

let notes = "";
let live: PaseoAgent[] = [];
let decisions: StoredDecision[] = [];

vi.mock("./agents", () => ({
  projectAgents: vi.fn(async (_paseo: unknown, _project: string, role?: string) => live.filter((agent) => role === undefined || agent.labels["taro.role"] === role)),
  listTaroAgents: vi.fn(async (_paseo: unknown, labels: Record<string, string>) => live.filter((agent) => Object.entries(labels).every(([key, value]) => agent.labels[key] === value))),
  projectArchivedAgents: vi.fn(async () => []),
  fetchLiveAgent: vi.fn(async (_paseo: unknown, id: string) => live.find((agent) => agent.id === id) ?? null),
  isAgentGone: vi.fn(async () => false),
  isMidTurn: (agent: { status: string }) => agent.status === "running",
}));
vi.mock("./send", () => ({ sendUserAnswer: vi.fn(async () => undefined), sendFromPlugin: vi.fn(async () => undefined), sendWithoutInterrupting: vi.fn(async () => undefined), sendCommand: vi.fn() }));
// The real templates, so the test reads the message the new owner gets.
vi.mock("./package-files", async (importOriginal) => ({ ...(await importOriginal<typeof import("./package-files")>()), skillDirectory: async () => "/skill" }));
vi.mock("./projects", () => ({
  projectPaths: async () => ({ tracker: "/tracker" }),
  listProjectConfigs: async () => [],
  requireProjectConfig: async () => ({ owner: { model: "claude/haiku", thinking: "" }, maxParallelOwners: 2 }),
}));
vi.mock("./headroom", () => ({ readHeadroom: async () => null }));
vi.mock("./models", () => ({ bypassModeId: async () => null }));
vi.mock("./environment", () => ({ taroEnvironment: async () => ({}) }));
vi.mock("./tickets", () => ({
  listTickets: vi.fn(async () => [{ id: "NA-1", title: "Notes list", status: "In Progress", parentTaskId: null, labels: [], dependencies: [], updatedAt: "2026-01-05T09:00:00Z" }]),
  viewTicket: vi.fn(async (_tracker: string, id: string) => ({ id, title: "Notes list", status: "In Progress", parentTaskId: null, labels: [], dependencies: [], implementationNotes: notes, updatedAt: "2026-01-05T09:00:00Z" })),
  appendTicketNote: vi.fn(async (_tracker: string, _id: string, record: string) => {
    notes = `${notes}\n\n${record}`;
  }),
}));

function agent(id: string, ticket = "NA-1", role = "owner"): PaseoAgent {
  return { id, status: "idle", workspaceId: "wks_NA1", updatedAt: "2026-01-05T09:00:00Z", labels: { "taro.project": "notes", "taro.role": role, "taro.ticket": ticket } } as unknown as PaseoAgent;
}

function decision(agentId: string, id: string, question: string, status: StoredDecision["status"] = "open", parts: Partial<StoredDecision> = {}): StoredDecision {
  return {
    id,
    question,
    why: "",
    blocking: false,
    options: [],
    recommended: "",
    reason: "",
    default: "",
    withdrawn: false,
    problems: [],
    key: `${agentId}:${id}`,
    project: "notes",
    ticket: "NA-1",
    agentId,
    agentRole: "owner",
    agentTitle: null,
    askedAt: "2026-01-05T09:10:00.000Z",
    turn: null,
    status,
    answer: null,
    ...parts,
  };
}

const prompts: { agentId: string; prompt: string }[] = [];
const paseo = {
  agents: { ref: (id: string) => ({ archive: async () => void (live = live.filter((each) => each.id !== id)) }) },
  workspaces: {
    ref: () => ({
      agents: {
        create: async (input: { agentId: string; prompt: string }) => {
          prompts.push({ agentId: input.agentId, prompt: input.prompt });
          live.push(agent(input.agentId));
        },
      },
    }),
  },
} as unknown as PaseoApi;

const state = { forgetAgent: async () => undefined, agent: async () => null, updateDecisions: async <T>(change: (stored: StoredDecision[]) => T) => change(decisions) } as unknown as PluginState;
// What the archive hook and every replacement do: the archived agent's open questions are withdrawn with it.
const supervisor = { withdrawDecisionsOf: async (id: string) => withdrawOpenDecisions(decisions, (each) => each.agentId === id, true) } as unknown as Supervisor;
let actions: Actions;

const EXECUTION = "EXECUTION 2026-01-05T09:00:00Z owner=owner-1 workspace=wks_NA1 worktree=/home/user/notes-app branch=taro/na-1 base=abc host=box";

beforeEach(() => {
  notes = EXECUTION;
  live = [agent("owner-1")];
  decisions = [];
  prompts.length = 0;
  actions = new Actions(state, supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
});

const lastPrompt = () => prompts.at(-1)!.prompt;

describe("an owner replaced hands its unanswered questions to the new owner (TR-136)", () => {
  it("on Relaunch: the open questions and the held-back one, with id, asker and text, and nothing the user answered or the owner withdrew", async () => {
    decisions = [
      decision("owner-1", "storage", "Store notes\n  locally or in the cloud?", "open", { askedAt: "2026-01-05T09:20:00.000Z" }),
      decision("owner-1", "naming", "Call it Notes or Memos?", "withdrawn", { withdrawnWithAgent: true, askedAt: "2026-01-05T09:05:00.000Z" }),
      decision("owner-1", "size", "Withdrawn by the owner itself?", "withdrawn"),
      decision("owner-1", "colour", "Held back while another was open?", "withdrawn", { held: true, askedAt: "2026-01-05T09:15:00.000Z" }),
      decision("owner-1", "merge", "Answered already?", "answered"),
      decision("reviewer-1", "nit", "A reviewer's question?", "open", { agentRole: "reviewer" }),
      decision("owner-9", "other", "Another ticket's question?", "open", { ticket: "NA-2" }),
      decision("owner-8", "elsewhere", "Another project's question?", "open", { project: "shop" }),
    ];
    const agentId = await actions.relaunchOwner(paseo, "notes", "NA-1");
    const prompt = lastPrompt();
    // Oldest first, each on one line.
    expect(prompt).toContain("questions to the user unanswered; they are no longer on the board");
    expect(prompt).toContain(
      "- `naming` (asked by owner-1): Call it Notes or Memos?\n- `colour` (held back, never shown to the user, by owner-1): Held back while another was open?\n- `storage` (asked by owner-1): Store notes locally or in the cloud?\n",
    );
    expect(prompt).toContain("one at a time");
    for (const left of ["size", "merge", "nit", "other", "elsewhere"]) expect(prompt).not.toContain(`\`${left}\``);
    expect(decisions.filter((each) => each.carriedTo === agentId).map((each) => each.id)).toEqual(["storage", "naming", "colour"]);
  });

  it("on Resume after Pause: the question withdrawn when the pause archived the owner", async () => {
    decisions = [decision("owner-1", "storage", "Store notes locally or in the cloud?")];
    await actions.pause(paseo, "notes", "NA-1");
    notes += "\n\nHANDOFF 2026-01-05T10:03Z\n- Phase: In Progress — list built";
    await actions.advancePauses(paseo, "notes", Date.now());
    expect(live).toEqual([]);
    expect(decisions[0]).toMatchObject({ status: "withdrawn", withdrawnWithAgent: true });
    const result = await actions.resume(paseo, "notes", "NA-1");
    expect(result.agentId).not.toBeNull();
    expect(lastPrompt()).toContain("- `storage` (asked by owner-1): Store notes locally or in the cloud?");
  });

  it("when the owner was archived by hand: the archive hook's withdrawal is handed on", async () => {
    decisions = [decision("owner-1", "storage", "Store notes locally or in the cloud?")];
    await paseo.agents.ref("owner-1").archive();
    await supervisor.withdrawDecisionsOf("owner-1");
    await actions.relaunchOwner(paseo, "notes", "NA-1");
    expect(lastPrompt()).toContain("- `storage` (asked by owner-1): Store notes locally or in the cloud?");
  });

  it("hands a question on again until an owner asks it again, then only that owner's copy", async () => {
    decisions = [decision("owner-1", "storage", "Store notes locally or in the cloud?")];
    const second = await actions.relaunchOwner(paseo, "notes", "NA-1");
    // The second owner is replaced before asking it.
    const third = await actions.relaunchOwner(paseo, "notes", "NA-1");
    expect(third).not.toBe(second);
    expect(lastPrompt()).toContain("- `storage` (asked by owner-1): Store notes locally or in the cloud?");
    // The third asks it again, reworded, and is replaced while it is open: the new wording, once.
    decisions.push(decision(third, "storage", "Store notes on the device or in the cloud?", "open", { askedAt: "2026-01-05T11:00:00.000Z" }));
    await actions.relaunchOwner(paseo, "notes", "NA-1");
    expect(lastPrompt()).toContain(`- \`storage\` (asked by ${third}): Store notes on the device or in the cloud?`);
    expect(lastPrompt().match(/`storage`/g)).toHaveLength(1);
  });

  it("drops a question the next owner asked again and the user answered", async () => {
    decisions = [decision("owner-1", "storage", "Store notes locally or in the cloud?")];
    const second = await actions.relaunchOwner(paseo, "notes", "NA-1");
    decisions.push(decision(second, "storage", "Store notes locally or in the cloud?", "answered"));
    await actions.relaunchOwner(paseo, "notes", "NA-1");
    expect(lastPrompt()).not.toContain("`storage`");
  });

  it("leaves the first message as it was when nothing was open", async () => {
    decisions = [decision("owner-1", "merge", "Answered already?", "answered")];
    await actions.relaunchOwner(paseo, "notes", "NA-1");
    expect(lastPrompt()).not.toContain("unanswered");
    expect(lastPrompt()).toMatch(/`paseo logs owner-1` if the ticket lacks a detail\.$/);
  });
});
