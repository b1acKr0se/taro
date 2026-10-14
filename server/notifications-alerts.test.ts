/** Board alerts reach the user as notifications (TR-064), through the Notifier's own look at the board. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "../shared/contracts";
import type { BoardAlert } from "../shared/recovery";
import type { PaseoApi } from "./host-types";
import { Notifier } from "./notifications";
import type { PluginState } from "./state";

let boardAlerts: BoardAlert[] = [];

vi.mock("./board", () => ({
  loadBoard: vi.fn(
    async (_paseo: unknown, _state: unknown, project: string, queueAlerts: readonly BoardAlert[] = []): Promise<Board> => ({
      project,
      cards: [],
      managerDecisions: [],
      suggestions: [],
      headroom: null,
      alerts: [...boardAlerts, ...queueAlerts],
      loadedAt: "2026-01-01T00:00:00Z",
      totals: { "needs-you": 0, working: 0, stalled: 0, queued: 0, done: 0 }, offPage: [],
    }),
  ),
}));

let notifyIn: Record<string, boolean> = {};

vi.mock("./projects", () => ({
  readProjectConfig: vi.fn(async (project: string) => ({ managerAgentId: "agent-manager", managerWorkspaceId: "workspace-manager", notify: notifyIn[project] ?? true })),
}));

const NOW = Date.parse("2026-01-01T12:00:00Z");
const paseo = {} as PaseoApi;
const state = {} as PluginState;

let home: string;
let previousHome: string | undefined;
let pushed: { title: string; body: string; data: Record<string, string> }[] = [];

function notifier(): Notifier {
  const fetchStub = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    pushed.push(...(JSON.parse(String(init?.body)) as typeof pushed));
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
  return new Notifier({ fetch: fetchStub as unknown as typeof fetch, now: () => NOW, pushUrl: "http://127.0.0.1:1/push" });
}

function queued(tickets: string[], minutes: number): BoardAlert {
  return { id: "queued-free-slot", tickets, text: `${tickets.join(", ")} queued with a free slot: the plugin told the Manager ${minutes} minutes ago.` };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-notify-alerts-"));
  previousHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  await writeFile(join(home, "push-tokens.json"), JSON.stringify({ subscriptions: [{ token: "ExponentPushToken[a]", expiresAt: "2026-02-01T00:00:00.000Z" }] }));
  await writeFile(join(home, "server-id"), "srv_test\n");
  boardAlerts = [];
  notifyIn = {};
  pushed = [];
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(home, { recursive: true, force: true });
});

describe("Notifier and board alerts", () => {
  it("announces a Manager that stopped overnight once, opening the Manager", async () => {
    const taro = notifier();
    await taro.check(paseo, state, "notes-app");
    boardAlerts = [{ id: "manager-crashed", tickets: [], text: "The Manager is stopped. It crashed three times in an hour. Restart it from the project's settings." }];
    expect(await taro.check(paseo, state, "notes-app")).toBe(1);
    expect(await taro.check(paseo, state, "notes-app")).toBe(0);
    expect(pushed).toEqual([
      {
        to: "ExponentPushToken[a]",
        title: "Manager crashed in notes-app",
        body: "The Manager is stopped. It crashed three times in an hour. Restart it from the project's settings.",
        data: { serverId: "srv_test", agentId: "agent-manager", workspaceId: "workspace-manager" },
        sound: "default",
      },
    ]);
  });

  it("announces the queued alert the queue check passes in, once while it is up", async () => {
    const taro = notifier();
    await taro.check(paseo, state, "notes-app", []);
    expect(await taro.check(paseo, state, "notes-app", [queued(["NA-001"], 10)])).toBe(1);
    // Its minutes move and another ticket joins: the same alert, not announced again.
    expect(await taro.check(paseo, state, "notes-app", [queued(["NA-001", "NA-002"], 14)])).toBe(0);
    // Dismissed or dispatched, then up again: a new episode.
    expect(await taro.check(paseo, state, "notes-app", [])).toBe(0);
    expect(await taro.check(paseo, state, "notes-app", [queued(["NA-003"], 10)])).toBe(1);
    expect(pushed.map((message) => message.title)).toEqual(["Queued with a free slot in notes-app", "Queued with a free slot in notes-app"]);
  });

  it("announces threads running low once for the host, not once per project", async () => {
    const taro = notifier();
    await taro.check(paseo, state, "notes-app");
    await taro.check(paseo, state, "shop");
    boardAlerts = [{ id: "headroom", tickets: [], text: "The host is at 1900 of 2048 threads (93%)." }];
    expect(await taro.check(paseo, state, "notes-app")).toBe(1);
    expect(await taro.check(paseo, state, "shop")).toBe(0);
    expect(pushed.map((message) => message.title)).toEqual(["Threads running low"]);
    // Cleared and back: announced again, once.
    boardAlerts = [];
    await taro.check(paseo, state, "notes-app");
    await taro.check(paseo, state, "shop");
    boardAlerts = [{ id: "headroom", tickets: [], text: "The host is at 1900 of 2048 threads (93%)." }];
    await taro.check(paseo, state, "shop");
    await taro.check(paseo, state, "notes-app");
    expect(pushed).toHaveLength(2);
  });

  it("lets a project with notifications switched off leave the host's alert to the others", async () => {
    notifyIn = { "notes-app": false };
    const taro = notifier();
    await taro.check(paseo, state, "notes-app");
    await taro.check(paseo, state, "shop");
    boardAlerts = [{ id: "headroom", tickets: [], text: "The host is at 1900 of 2048 threads (93%)." }];
    expect(await taro.check(paseo, state, "notes-app")).toBe(0);
    expect(await taro.check(paseo, state, "shop")).toBe(1);
  });
});
