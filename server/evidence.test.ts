// TR-021.02: evidence judged against the ticket's folder, the Accept guard and the Ticket tab's detail.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadTicketDetail } from "./board";
import type { PaseoApi } from "./host-types";
import { mockupsMissing, requireCompleteEvidence, ticketEvidence, ticketEvidenceDirectory, ticketMockups } from "./evidence";
import { viewTicket } from "./tickets";

vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: "/tracker" }) }));
vi.mock("./tickets", () => ({ listTickets: vi.fn(), viewTicket: vi.fn() }));

const complete = [
  "EVIDENCE 2026-10-13T11:00Z — before FINAL",
  "check: npm test — 3 passed",
  "review: self-review — clean",
  "ux: own pass — nothing a user would reject",
  "coverage: the list — list-phone.png",
  "screenshot: list-phone.png — the list on a phone",
].join("\n");

let home: string;
let previousHome: string | undefined;

beforeEach(async () => {
  previousHome = process.env.PASEO_HOME;
  home = await mkdtemp(join(tmpdir(), "taro-evidence-"));
  process.env.PASEO_HOME = home;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(home, { recursive: true, force: true });
});

async function addShot(name: string): Promise<void> {
  const folder = ticketEvidenceDirectory("notes", "NA-1");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, name), "png");
}

describe("ticketEvidence", () => {
  it("finds the screenshot file in <evidence>/<project>/<ticket> and gives its absolute path", async () => {
    await addShot("list-phone.png");
    const evidence = await ticketEvidence("notes", "NA-1", complete, []);
    expect(evidence.complete).toBe(true);
    expect(evidence.screenshots[0]?.path).toBe(join(home, "plugin-data", "taro", "evidence", "notes", "NA-1", "list-phone.png"));
  });

  it("skips the coverage map only for a ticket already Done (TR-079)", async () => {
    await addShot("list-phone.png");
    const unmapped = complete.replace("coverage: the list — list-phone.png\n", "");
    expect((await ticketEvidence("notes", "NA-1", unmapped, [], "Awaiting acceptance")).missing).toEqual(["the coverage map (coverage: <section or state> — <screenshot>)"]);
    expect((await ticketEvidence("notes", "NA-1", unmapped, [], "Done")).complete).toBe(true);
    await expect(requireCompleteEvidence("notes", "NA-1", unmapped, [])).rejects.toThrow(/coverage map/);
  });

  it("names the screenshot file that is not there", async () => {
    const evidence = await ticketEvidence("notes", "NA-1", complete, []);
    expect(evidence.missing).toEqual(["screenshot file list-phone.png"]);
  });
});

describe("requireCompleteEvidence", () => {
  it("refuses with what is missing, and lets complete evidence through", async () => {
    await expect(requireCompleteEvidence("notes", "NA-1", null, [])).rejects.toThrow(/an EVIDENCE record/);
    await expect(requireCompleteEvidence("notes", "NA-1", complete, [])).rejects.toThrow(/screenshot file list-phone\.png/);
    await addShot("list-phone.png");
    await expect(requireCompleteEvidence("notes", "NA-1", complete, [])).resolves.toBeUndefined();
  });

  it("asks an investigation only for a check", async () => {
    await expect(requireCompleteEvidence("notes", "NA-1", "EVIDENCE 2026-10-13T11:00Z — x\ncheck: grep foo — 2 hits", ["investigation"])).resolves.toBeUndefined();
  });
});

describe("loadTicketDetail evidence", () => {
  function detail(status: string, implementationNotes: string | null) {
    vi.mocked(viewTicket).mockResolvedValue({
      id: "NA-1", title: "t", status, labels: [], description: null, acceptanceCriteria: [], implementationPlan: null, implementationNotes,
      finalSummary: null, dependencies: [], subtasks: [],
    } as unknown as Awaited<ReturnType<typeof viewTicket>>);
  }

  it("carries evidence once a record exists or the ticket awaits acceptance, else null", async () => {
    detail("In Progress", null);
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).evidence).toBeNull();
    detail("Awaiting acceptance", null);
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).evidence?.missing).toEqual(["an EVIDENCE record"]);
    detail("In Progress", complete);
    expect((await loadTicketDetail({} as PaseoApi, "notes", "NA-1")).evidence?.checks).toHaveLength(1);
  });
});

// TR-235: a plan's mockups against the files in the ticket's evidence folder.
describe("plan mockups", () => {
  const plan = "## Goal\nG\n## Mockups\n- mockup-list-phone.png — the list gains a badge\n## Size\nS";

  it("finds the mockup files with their absolute paths, and reports one that is absent", async () => {
    await addShot("mockup-list-phone.png");
    const view = await ticketMockups("notes", "NA-1", plan);
    expect(view?.images).toEqual([{ file: "mockup-list-phone.png", description: "the list gains a badge", present: true, path: join(home, "plugin-data", "taro", "evidence", "notes", "NA-1", "mockup-list-phone.png") }]);
    expect(view?.missing).toEqual([]);
    expect(await mockupsMissing("notes", "NA-2", plan)).toEqual(["mockup file mockup-list-phone.png in the evidence folder"]);
  });

  it("has no view without a Mockups section, and asks for one of a template plan", async () => {
    expect(await ticketMockups("notes", "NA-1", "## Goal\nG")).toBeNull();
    expect(await ticketMockups("notes", "NA-1", null)).toBeNull();
    expect(await mockupsMissing("notes", "NA-1", "## Goal\nG")).toHaveLength(1);
    expect(await mockupsMissing("notes", "NA-1", "free-form plan")).toEqual([]);
    expect(await mockupsMissing("notes", "NA-1", null)).toEqual([]);
  });
});
