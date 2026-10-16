// TR-081: a ticket file that cannot be read hides its own card only, with one alert naming the file and line until it is fixed.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { alertHeading } from "../shared/alerts";
import { serializeTicket, type Ticket } from "../shared/ticket-format";
import { invalidateBoards, loadBoard } from "./board";
import type { PaseoApi } from "./host-types";
import type { PluginState } from "./state";

const paths = vi.hoisted(() => ({ tracker: "" }));
vi.mock("./agents", () => ({ projectAgents: async () => [], projectArchivedAgents: async () => [] }));
vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: paths.tracker, suggestions: "/nonexistent/taro-suggestions.md" }), readProjectConfig: async () => null }));
vi.mock("./headroom", () => ({ readHeadroom: async () => null }));

const state = { allDecisions: async () => [], allAgents: async () => ({}) } as unknown as PluginState;

function ticket(id: string): Ticket {
  return {
    id,
    title: `Title of ${id}`,
    status: "Queued",
    priority: null,
    labels: [],
    parent: null,
    dependsOn: [],
    created: "2026-10-14T15:46:00Z",
    updated: "2026-10-14T15:46:00Z",
    description: "",
    plan: "",
    criteria: [],
    notes: "",
    finalSummary: "",
    extra: {},
  };
}

function write(id: string, text: string): void {
  writeFileSync(join(paths.tracker, "tickets", `${id}.md`), text);
}

async function board() {
  invalidateBoards();
  return loadBoard({} as PaseoApi, state, "notes");
}

beforeEach(() => {
  paths.tracker = mkdtempSync(join(tmpdir(), "taro-board-files-"));
  mkdirSync(join(paths.tracker, "tickets"));
  for (const id of ["NA-001", "NA-002", "NA-003"]) write(id, serializeTicket(ticket(id)));
});

afterEach(() => {
  rmSync(paths.tracker, { recursive: true, force: true });
});

describe("a bad ticket file on the board", () => {
  it("leaves its card off, shows the others and one alert naming the file and line, and clears once fixed", async () => {
    const good = serializeTicket(ticket("NA-002"));
    // Line 5 is `status:`; an unknown status is a problem there.
    write("NA-002", good.replace('status: "Queued"', 'status: "Someday"'));

    const broken = await board();
    expect(broken.cards.map((card) => card.id)).toEqual(["NA-001", "NA-003"]);
    expect(broken.alerts).toHaveLength(1);
    expect(broken.alerts[0]?.id).toBe("ticket-file:tickets/NA-002.md");
    expect(broken.alerts[0]?.text).toMatch(/^tickets\/NA-002\.md line 5: /);
    expect(alertHeading(broken.alerts[0]?.id ?? "")).toBe("Ticket file unreadable");

    write("NA-002", good);
    const fixed = await board();
    expect(fixed.cards.map((card) => card.id)).toEqual(["NA-001", "NA-002", "NA-003"]);
    expect(fixed.alerts).toEqual([]);
  });
});
