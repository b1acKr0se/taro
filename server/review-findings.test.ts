// The `taro.stats.findings` RPC: a project's review findings by author model, read from a scratch tracker.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadReviewFindings } from "../shared/contracts";
import { projectFindings } from "./review-findings";
import { createTicketStore } from "./ticket-store";

const paths = vi.hoisted(() => ({ tracker: "" }));
vi.mock("./projects", () => ({ projectPaths: async () => ({ tracker: paths.tracker }) }));

const ZEROS = { model: "All models", tickets: 0, high: 0, medium: 0, low: 0, escapes: 0 };

function review(line: string): string {
  return `REVIEW 2026-01-05T10:00Z — reviewer (Opus) over main..taro/na-1: F1 fixed in 4d5e6f7\n${line}\nverdict: clean`;
}

let scratch = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "taro-review-findings-"));
  paths.tracker = join(scratch, "tracker");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("taro.stats.findings", () => {
  it("answers empty for a project without a tracker", async () => {
    expect(loadReviewFindings.name).toMatch(/^[a-z][a-z0-9._-]*$/);
    expect(await projectFindings("empty-app")).toEqual({ models: [], all: ZEROS, reviews: 0 });
    // An answer from an older or newer daemon missing fields still parses, every field defaulted.
    expect(loadReviewFindings.output.parse({})).toEqual({ models: [], all: ZEROS, reviews: 0 });
    expect(loadReviewFindings.output.parse({ models: [{ model: "claude-opus-5-5" }], all: {} })).toEqual({
      models: [{ model: "claude-opus-5-5", tickets: 0, high: 0, medium: 0, low: 0, escapes: 0 }],
      all: { model: "", tickets: 0, high: 0, medium: 0, low: 0, escapes: 0 },
      reviews: 0,
    });
  });

  it("answers empty for a tracker without tickets", async () => {
    const store = createTicketStore(paths.tracker, { prefix: "NA" });
    await store.create({ title: "Removed" }).then((ticket) => rmSync(join(paths.tracker, "tickets", `${ticket.id}.md`)));
    expect(await projectFindings("notes-app")).toEqual({ models: [], all: ZEROS, reviews: 0 });
  });

  it("reads a scratch tracker's tickets", async () => {
    const store = createTicketStore(paths.tracker, { prefix: "NA" });
    const first = await store.create({ title: "Export notes", status: "Done" });
    await store.appendNote(first.id, review("findings: claude-sonnet-5-5 — high 1, medium 2, low 0"));
    await store.appendNote(first.id, "ESCAPE 2026-01-09T08:00Z — the export lost the last note");
    const second = await store.create({ title: "Import notes", status: "Done" });
    await store.appendNote(second.id, review("findings: claude/claude-sonnet-5-5[1m] — high 0, medium 1, low 1"));
    const planned = await store.create({ title: "Sync notes" });
    await store.appendNote(planned.id, "REVIEW 2026-01-06T10:00Z — plan review by a fresh agent\nfindings: claude-opus-5-5 — high 3, medium 0, low 0\nverdict: clean");

    const expected = {
      models: [{ model: "claude-sonnet-5-5", tickets: 2, high: 1, medium: 3, low: 1, escapes: 1 }],
      all: { model: "All models", tickets: 2, high: 1, medium: 3, low: 1, escapes: 1 },
      reviews: 2,
    };
    expect(await projectFindings("notes-app")).toEqual(expected);

    // A record added since the last load is read; a removed ticket stops counting.
    await store.appendNote(planned.id, review("findings: claude-haiku-5-5 — high 2, medium 0, low 0"));
    rmSync(join(paths.tracker, "tickets", `${second.id}.md`));
    const after = await projectFindings("notes-app");
    expect(after.models).toEqual([
      { model: "claude-haiku-5-5", tickets: 1, high: 2, medium: 0, low: 0, escapes: 0 },
      { model: "claude-sonnet-5-5", tickets: 1, high: 1, medium: 2, low: 0, escapes: 1 },
    ]);
    expect(after.reviews).toBe(2);
  });

  it("answers quickly on a tracker of 300 tickets", async () => {
    const store = createTicketStore(paths.tracker, { prefix: "NA" });
    for (let index = 0; index < 300; index++) {
      const ticket = await store.create({ title: `Notes feature ${index}`, status: "Done" });
      await store.appendNote(ticket.id, review(`findings: claude-${["opus", "sonnet", "haiku"][index % 3]}-5-5 — high ${index % 2}, medium 1, low 2`));
    }
    const cold = performance.now();
    const answer = await projectFindings("notes-app");
    const coldMs = performance.now() - cold;
    const warm = performance.now();
    await projectFindings("notes-app");
    const warmMs = performance.now() - warm;
    console.log(`[review-findings] 300 tickets: first load ${coldMs.toFixed(0)} ms, next ${warmMs.toFixed(0)} ms`);
    expect(answer.all.tickets).toBe(300);
    expect(answer.reviews).toBe(300);
    expect(coldMs).toBeLessThan(1_000);
    expect(warmMs).toBeLessThan(300);
  }, 60_000);
});
