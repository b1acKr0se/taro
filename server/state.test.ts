// TR-043: the ticket statuses the plugin last acted on are on disk, so a reload or daemon restart
// sees the changes made meanwhile.
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { askFromRequest } from "../shared/permission-asks";
import { PluginState } from "./state";

let home: string;
const previousHome = process.env.PASEO_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-state-"));
  process.env.PASEO_HOME = home;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(home, { recursive: true, force: true });
});

describe("stored ticket statuses", () => {
  it("are null for a project never stored", async () => {
    expect(await new PluginState().ticketStatuses("demo")).toBeNull();
  });

  it("are read back by a new instance, per project", async () => {
    const first = new PluginState();
    await first.saveTicketStatuses("demo", new Map([["DM-1", "Awaiting acceptance"], ["DM-2", "Queued"]]));
    await first.saveTicketStatuses("other", new Map([["OT-1", "Done"]]));
    await first.saveTicketStatuses("demo", new Map([["DM-1", "Done"], ["DM-2", "Queued"]]));

    const second = new PluginState();
    expect(await second.ticketStatuses("demo")).toEqual(new Map([["DM-1", "Done"], ["DM-2", "Queued"]]));
    expect(await second.ticketStatuses("other")).toEqual(new Map([["OT-1", "Done"]]));
    const file = JSON.parse(await readFile(join(home, "plugin-data", "taro", "state", "ticket-statuses.json"), "utf8")) as unknown;
    expect(file).toEqual({ projects: { demo: { "DM-1": "Done", "DM-2": "Queued" }, other: { "OT-1": "Done" } } });
  });

  it("start over when the file is unreadable", async () => {
    await mkdir(join(home, "plugin-data", "taro", "state"), { recursive: true });
    await writeFile(join(home, "plugin-data", "taro", "state", "ticket-statuses.json"), "{ not json");
    expect(await new PluginState().ticketStatuses("demo")).toBeNull();
  });

  it("keep an empty project as stored, not as missing", async () => {
    await new PluginState().saveTicketStatuses("demo", new Map());
    expect(await new PluginState().ticketStatuses("demo")).toEqual(new Map());
  });

  it("are forgotten for one project, the others kept", async () => {
    const first = new PluginState();
    await first.saveTicketStatuses("demo", new Map([["DM-1", "Done"]]));
    await first.saveTicketStatuses("other", new Map([["OT-1", "Done"]]));
    await first.forgetTicketStatuses("demo");
    await first.forgetTicketStatuses("never");
    const second = new PluginState();
    expect(await second.ticketStatuses("demo")).toBeNull();
    expect(await second.ticketStatuses("other")).toEqual(new Map([["OT-1", "Done"]]));
  });
});

describe("permission asks (TR-149)", () => {
  const bash = (id: string, at: string, agentId = "agent-1") => askFromRequest(agentId, { id, name: "Bash", kind: "tool", input: { command: `rm -rf /tmp/${id}` } }, at);
  const now = () => new Date().toISOString();

  it("are empty when none was recorded, and an answer to an unknown request is ignored", async () => {
    const state = new PluginState();
    expect(await state.answeredPermissionAsks("agent-1")).toEqual([]);
    expect(await state.resolvePermissionAsk("agent-1", "never", { behavior: "allow" }, now())).toBe(false);
    expect(await state.markPermissionAskByRules("agent-1", "never", "root")).toBe(false);
    await state.clearPermissionAskRules("agent-1", "never");
    expect(await new PluginState().answeredPermissionAsks("agent-1")).toEqual([]);
  });

  it("list one agent's answered asks only, oldest asked first, read back by a new instance", async () => {
    const state = new PluginState();
    const base = Date.now() - 60_000;
    const at = (seconds: number) => new Date(base + seconds * 1000).toISOString();
    await state.recordPermissionAsk(bash("second", at(2)));
    await state.recordPermissionAsk(bash("first", at(1)));
    await state.recordPermissionAsk(bash("open", at(3)));
    await state.recordPermissionAsk(bash("other", at(1), "agent-2"));
    expect(await state.resolvePermissionAsk("agent-1", "second", { behavior: "deny", message: "not there" }, at(5))).toBe(true);
    await state.resolvePermissionAsk("agent-1", "first", { behavior: "allow" }, at(6));
    await state.resolvePermissionAsk("agent-2", "other", { behavior: "allow" }, at(6));
    const asks = await new PluginState().answeredPermissionAsks("agent-1");
    expect(asks.map((ask) => [ask.requestId, ask.outcome, ask.by, ask.words])).toEqual([
      ["first", "allowed", "you", null],
      ["second", "denied", "you", "not there"],
    ]);
  });

  it("count an answer as the rules' when they marked the ask first, and as the user's once the mark is taken back", async () => {
    const state = new PluginState();
    await state.recordPermissionAsk(bash("ruled", now()));
    await state.recordPermissionAsk(bash("failed", now()));
    expect(await state.markPermissionAskByRules("agent-1", "ruled", "top-level")).toBe(true);
    await state.resolvePermissionAsk("agent-1", "ruled", { behavior: "deny", message: "The plugin denied it: a long template" }, now());
    await state.markPermissionAskByRules("agent-1", "failed", "root");
    await state.resolvePermissionAsk("agent-1", "failed", { behavior: "allow" }, now());
    await state.clearPermissionAskRules("agent-1", "failed");
    const asks = await state.answeredPermissionAsks("agent-1");
    expect(asks.find((ask) => ask.requestId === "ruled")).toMatchObject({ outcome: "denied", by: "rules", rule: "top-level", words: null });
    expect(asks.find((ask) => ask.requestId === "failed")).toMatchObject({ outcome: "allowed", by: "you", rule: null });
  });

  it("drop asks 14 days old on the next write", async () => {
    const state = new PluginState();
    const old = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000 - 1000).toISOString();
    await state.recordPermissionAsk(bash("old", old));
    await state.recordPermissionAsk(bash("new", now()));
    const file = JSON.parse(await readFile(join(home, "plugin-data", "taro", "state", "permission-asks.json"), "utf8")) as { asks: { requestId: string }[] };
    expect(file.asks.map((ask) => ask.requestId)).toEqual(["new"]);
  });
});
