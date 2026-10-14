// TR-043: the ticket statuses the plugin last acted on are on disk, so a reload or daemon restart
// sees the changes made meanwhile.
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    await first.saveTicketStatuses("demo", new Map([["DM-1", "Awaiting acceptance"], ["DM-2", "Backlog"]]));
    await first.saveTicketStatuses("other", new Map([["OT-1", "Done"]]));
    await first.saveTicketStatuses("demo", new Map([["DM-1", "Done"], ["DM-2", "Backlog"]]));

    const second = new PluginState();
    expect(await second.ticketStatuses("demo")).toEqual(new Map([["DM-1", "Done"], ["DM-2", "Backlog"]]));
    expect(await second.ticketStatuses("other")).toEqual(new Map([["OT-1", "Done"]]));
    const file = JSON.parse(await readFile(join(home, "plugin-data", "taro", "state", "ticket-statuses.json"), "utf8")) as unknown;
    expect(file).toEqual({ projects: { demo: { "DM-1": "Done", "DM-2": "Backlog" }, other: { "OT-1": "Done" } } });
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
});
