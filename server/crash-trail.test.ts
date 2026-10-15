import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { trailError, type Device, type TrailReport } from "../shared/crash-trail";
import { createCrashTrail } from "./crash-trail";

const phone: Device = { platform: "android", os: "14", model: "Google Pixel 8", window: "412×915" };

function report(launch: string, overrides: Partial<TrailReport> = {}): TrailReport {
  return { launch, device: phone, state: "foreground", steps: [{ at: "2026-10-15T09:00:00.000Z", kind: "screen", what: "project notes-app" }], errors: [], ...overrides };
}

describe("createCrashTrail", () => {
  let folder = "";
  let path = "";
  let clock = Date.parse("2026-10-15T09:00:00.000Z");
  const logged: string[] = [];

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "crash-trail-"));
    path = join(folder, "crash-trail.json");
    logged.length = 0;
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  function trail() {
    return createCrashTrail({ path, now: () => clock, log: (line) => logged.push(line) });
  }

  it("keeps a launch's trail in the file and reports it to the next launch after a crash", async () => {
    const store = trail();
    await store.report(report("launch0001", { errors: [trailError("fatal", "app", new Error("boom"), "2026-10-15T09:01:00.000Z")] }));
    const file = JSON.parse(await readFile(path, "utf8")) as { launches: { launch: string }[] };
    expect(file.launches.map((launch) => launch.launch)).toEqual(["launch0001"]);
    expect(logged).toEqual(["[taro] client error (fatal, app) on android Google Pixel 8: Error: boom"]);

    clock += 60_000;
    const crash = await trail().last("launch0002", phone);
    expect(crash).toMatchObject({ launch: "launch0001", cause: "error", file: path });
  });

  it("stops reporting a crash once dismissed", async () => {
    const store = trail();
    await store.report(report("launch0001"));
    expect(await store.last("launch0002", phone)).not.toBeNull();
    await store.dismiss("launch0001");
    expect(await store.last("launch0002", phone)).toBeNull();
  });

  it("refuses a launch's reports past the per-minute limit, then accepts again", async () => {
    const store = trail();
    for (let index = 0; index < 25; index += 1) {
      await store.report(report("launch0001", { steps: [{ at: "2026-10-15T09:00:00.000Z", kind: "press", what: `step-${index}` }] }));
    }
    const read = async () => (JSON.parse(await readFile(path, "utf8")) as { launches: { steps: unknown[] }[] }).launches[0]?.steps.length;
    expect(await read()).toBe(20);
    clock += 61_000;
    await store.report(report("launch0001"));
    expect(await read()).toBe(21);
  });

  it("starts over from a file it cannot read", async () => {
    await writeFile(path, "{ not json", "utf8");
    const store = trail();
    expect(await store.last("launch0002", phone)).toBeNull();
    await store.report(report("launch0001"));
    expect(await store.last("launch0002", phone)).toMatchObject({ launch: "launch0001" });
  });

  it("keeps every report when several land at once", async () => {
    const store = trail();
    await Promise.all(["launch0001", "launch0002", "launch0003"].map((launch) => store.report(report(launch))));
    const file = JSON.parse(await readFile(path, "utf8")) as { launches: unknown[] };
    expect(file.launches).toHaveLength(3);
  });
});
