import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NeedsYouEntry } from "../shared/notifications";
import { activePushTokens, expoMessages, Notifier } from "./notifications";

const NOW = Date.parse("2026-01-01T12:00:00Z");
const LATER = "2026-02-01T00:00:00.000Z";
const EARLIER = "2025-12-01T00:00:00.000Z";

let home: string;
let previousHome: string | undefined;
let previousServerId: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-notify-"));
  previousHome = process.env.PASEO_HOME;
  previousServerId = process.env.PASEO_SERVER_ID;
  process.env.PASEO_HOME = home;
  delete process.env.PASEO_SERVER_ID;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  if (previousServerId === undefined) delete process.env.PASEO_SERVER_ID;
  else process.env.PASEO_SERVER_ID = previousServerId;
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

function entry(key: string, parts: Partial<NeedsYouEntry> = {}): NeedsYouEntry {
  return { key, title: `${key} is ready to accept`, body: "Drafts sync.", agentId: "agent-1", workspaceId: "workspace-1", ...parts };
}

async function registerPhones(tokens: { token: string; expiresAt: string }[]): Promise<string> {
  const text = JSON.stringify({ subscriptions: tokens });
  await writeFile(join(home, "push-tokens.json"), text);
  await writeFile(join(home, "server-id"), "srv_test\n");
  return text;
}

interface Sent {
  url: string;
  messages: { to: string; title: string; body: string; data: Record<string, string> }[];
}

function fakeFetch(answer: unknown = { data: [] }, status = 200): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), messages: JSON.parse(String(init?.body)) as Sent["messages"] });
    return new Response(JSON.stringify(answer), { status });
  });
  return { fetch: fetchStub as unknown as typeof fetch, sent };
}

function notifier(fetchStub: typeof fetch, now = () => NOW): Notifier {
  return new Notifier({ fetch: fetchStub, now, pushUrl: "http://127.0.0.1:1/push" });
}

describe("activePushTokens", () => {
  it("keeps tokens whose lease runs past now, once each, trimmed", () => {
    const raw = {
      subscriptions: [
        { token: " ExponentPushToken[a] ", expiresAt: LATER },
        { token: "ExponentPushToken[a]", expiresAt: LATER },
        { token: "ExponentPushToken[old]", expiresAt: EARLIER },
        { token: "ExponentPushToken[now]", expiresAt: new Date(NOW).toISOString() },
      ],
    };
    expect(activePushTokens(raw, NOW)).toEqual(["ExponentPushToken[a]"]);
  });

  it("reads nothing from a missing, reshaped or broken file", () => {
    expect(activePushTokens(null, NOW)).toEqual([]);
    expect(activePushTokens({ tokens: ["x"] }, NOW)).toEqual([]);
    expect(activePushTokens({ subscriptions: [null, 3, { token: "", expiresAt: LATER }, { token: "x", expiresAt: "soon" }, { token: "y" }] }, NOW)).toEqual([]);
  });
});

describe("expoMessages", () => {
  it("sends Paseo's routing fields, leaving out the unknown ones", () => {
    expect(expoMessages(["t1"], entry("NA-1"), "srv_1")).toEqual([
      { to: "t1", title: "NA-1 is ready to accept", body: "Drafts sync.", data: { serverId: "srv_1", agentId: "agent-1", workspaceId: "workspace-1" }, sound: "default" },
    ]);
    expect(expoMessages(["t1"], entry("NA-1", { agentId: null, workspaceId: null }), null)[0]?.data).toEqual({});
  });
});

describe("Notifier", () => {
  it("announces nothing on a project's first look, then each new entry once, to every phone", async () => {
    const file = await registerPhones([
      { token: "ExponentPushToken[a]", expiresAt: LATER },
      { token: "ExponentPushToken[b]", expiresAt: LATER },
    ]);
    const { fetch, sent } = fakeFetch();
    const taro = notifier(fetch);
    expect(await taro.announce("notes-app", [entry("NA-1")], true)).toBe(0);
    expect(await taro.announce("notes-app", [entry("NA-1"), entry("NA-2")], true)).toBe(1);
    expect(await taro.announce("notes-app", [entry("NA-1"), entry("NA-2")], true)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("http://127.0.0.1:1/push");
    expect(sent[0]?.messages.map((message) => [message.to, message.title, message.data.serverId])).toEqual([
      ["ExponentPushToken[a]", "NA-2 is ready to accept", "srv_test"],
      ["ExponentPushToken[b]", "NA-2 is ready to accept", "srv_test"],
    ]);
    // Paseo's token file is read, never rewritten.
    expect(await readFile(join(home, "push-tokens.json"), "utf8")).toBe(file);
  });

  it("does not announce again after a reload", async () => {
    await registerPhones([{ token: "ExponentPushToken[a]", expiresAt: LATER }]);
    const { fetch, sent } = fakeFetch();
    await notifier(fetch).announce("notes-app", [], true);
    await notifier(fetch).announce("notes-app", [entry("NA-1")], true);
    await notifier(fetch).announce("notes-app", [entry("NA-1")], true);
    expect(sent).toHaveLength(1);
  });

  it("keeps each project's entries apart", async () => {
    await registerPhones([{ token: "ExponentPushToken[a]", expiresAt: LATER }]);
    const { fetch, sent } = fakeFetch();
    const taro = notifier(fetch);
    await taro.announce("notes-app", [], true);
    await taro.announce("shop", [], true);
    await taro.announce("notes-app", [entry("NA-1")], true);
    await taro.announce("shop", [entry("NA-1")], true);
    expect(sent).toHaveLength(2);
  });

  it("switched off, sends nothing but takes entries as seen, so switching on announces nothing old", async () => {
    await registerPhones([{ token: "ExponentPushToken[a]", expiresAt: LATER }]);
    const { fetch, sent } = fakeFetch();
    const taro = notifier(fetch);
    await taro.announce("notes-app", [], false);
    expect(await taro.announce("notes-app", [entry("NA-1")], false)).toBe(0);
    expect(await taro.announce("notes-app", [entry("NA-1")], true)).toBe(0);
    expect(sent).toEqual([]);
    expect(taro.poll("window", false, 0).notifications).toEqual([]);
  });

  it("gives a window what was sent after its last poll, and nothing from before its first", async () => {
    await registerPhones([]);
    const { fetch } = fakeFetch();
    const taro = notifier(fetch);
    await taro.announce("notes-app", [], true);
    await taro.announce("notes-app", [entry("NA-1")], true);
    const first = taro.poll("window", false, -1);
    expect(first).toEqual({ seq: 1, notifications: [] });
    await taro.announce("notes-app", [entry("NA-1"), entry("NA-2")], true);
    const second = taro.poll("window", false, first.seq);
    expect(second.notifications.map((notification) => [notification.seq, notification.title, notification.data])).toEqual([
      [2, "NA-2 is ready to accept", { serverId: "srv_test", agentId: "agent-1", workspaceId: "workspace-1" }],
    ]);
    expect(taro.poll("window", false, second.seq).notifications).toEqual([]);
    // A window that counted further before a reload gets all that was sent since.
    expect(taro.poll("window", false, 40).notifications).toHaveLength(2);
  });

  it("does not push the phone while a window was used in the last three minutes", async () => {
    await registerPhones([{ token: "ExponentPushToken[a]", expiresAt: LATER }]);
    const { fetch, sent } = fakeFetch();
    let now = NOW;
    const taro = notifier(fetch, () => now);
    await taro.announce("notes-app", [], true);
    taro.poll("window", true, -1);
    await taro.announce("notes-app", [entry("NA-1")], true);
    expect(sent).toEqual([]);
    expect(taro.poll("window", true, 0).notifications).toHaveLength(1);
    now += 180_001;
    await taro.announce("notes-app", [entry("NA-1"), entry("NA-2")], true);
    expect(sent).toHaveLength(1);
  });

  it("pushes again once the window says it is no longer in use", async () => {
    await registerPhones([{ token: "ExponentPushToken[a]", expiresAt: LATER }]);
    const { fetch, sent } = fakeFetch();
    const taro = notifier(fetch);
    await taro.announce("notes-app", [], true);
    taro.poll("window", true, -1);
    taro.poll("window", false, 0);
    await taro.announce("notes-app", [entry("NA-1")], true);
    expect(sent).toHaveLength(1);
  });

  it("sends nothing and does not fail without a token file, and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { fetch, sent } = fakeFetch();
    const taro = notifier(fetch);
    await taro.announce("notes-app", [], true);
    await taro.announce("notes-app", [entry("NA-1")], true);
    await taro.announce("notes-app", [entry("NA-1"), entry("NA-2")], true);
    expect(sent).toEqual([]);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("push")).length).toBe(1);
  });

  it("sends nothing from a reshaped or broken token file", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { fetch, sent } = fakeFetch();
    const taro = notifier(fetch);
    await taro.announce("notes-app", [], true);
    await writeFile(join(home, "push-tokens.json"), JSON.stringify({ tokens: ["ExponentPushToken[a]"] }));
    await taro.announce("notes-app", [entry("NA-1")], true);
    await writeFile(join(home, "push-tokens.json"), "{ not json");
    await taro.announce("notes-app", [entry("NA-1"), entry("NA-2")], true);
    expect(sent).toEqual([]);
  });

  it("survives the push service failing, refusing, or answering an error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await registerPhones([{ token: "ExponentPushToken[a]", expiresAt: LATER }]);
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const taro = notifier(failing);
    await taro.announce("notes-app", [], true);
    await expect(taro.announce("notes-app", [entry("NA-1")], true)).resolves.toBe(1);
    await expect(notifier(fakeFetch({}, 500).fetch).announce("notes-app", [entry("NA-1"), entry("NA-2")], true)).resolves.toBe(1);
    await expect(
      notifier(fakeFetch({ data: [{ status: "error", message: "DeviceNotRegistered" }] }).fetch).announce("notes-app", [entry("NA-1"), entry("NA-2"), entry("NA-3")], true),
    ).resolves.toBe(1);
    expect(error.mock.calls.map((call) => String(call[0])).join("\n")).toMatch(/could not send[\s\S]*answered 500[\s\S]*refused: DeviceNotRegistered/);
  });

  it("reads the server id from Paseo's override first", async () => {
    await registerPhones([{ token: "ExponentPushToken[a]", expiresAt: LATER }]);
    process.env.PASEO_SERVER_ID = "srv_override";
    const { fetch, sent } = fakeFetch();
    expect(await notifier(fetch).sendTest()).toBe(1);
    expect(sent[0]?.messages[0]).toMatchObject({ title: "Taro test", data: { serverId: "srv_override" } });
  });

  it("sends in batches of at most 100", async () => {
    await registerPhones(Array.from({ length: 150 }, (_, index) => ({ token: `ExponentPushToken[${index}]`, expiresAt: LATER })));
    const { fetch, sent } = fakeFetch();
    await notifier(fetch).sendTest();
    expect(sent.map((batch) => batch.messages.length)).toEqual([100, 50]);
  });
});
