/** The plugin's stop of a ticket's test daemons, on real processes: a stub `paseo`, a leftover that names the daemon's home. */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { daemonRecordPath, readDaemonRecords, startTestDaemon, stopTestDaemons } from "./test-daemons";

let scratch = "";
let home = "";
const previous = { PASEO_HOME: process.env.PASEO_HOME, PASEO_CLI: process.env.PASEO_CLI };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "taro-test-daemons-"));
  home = mkdtempSync("/tmp/paseo-TR-90-");
  process.env.PASEO_HOME = join(scratch, "paseo-home");
  const stub = join(scratch, "paseo");
  writeFileSync(stub, `#!/bin/sh\necho "$@" >> "${join(scratch, "calls.log")}"\n`);
  chmodSync(stub, 0o755);
  process.env.PASEO_CLI = stub;
  vi.resetModules();
});

afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

/** A pid that was used and is free now. */
function freedPid(): number {
  const exited = spawnSync("true");
  return exited.pid ?? 999_999;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("stopTicketDaemons", () => {
  it("kills by pid what a daemon whose pid is gone left, deletes its home and forgets it, without asking it to stop", async () => {
    const recordPath = daemonRecordPath(join(process.env.PASEO_HOME as string, "plugin-data", "taro"), "notes-app", "TR-90");
    mkdirSync(join(recordPath, ".."), { recursive: true });
    writeFileSync(recordPath, JSON.stringify([{ home, port: 6851, pid: freedPid(), startedAt: "2026-11-12T07:00:00.000Z", startedBy: null }]));
    // A plugin process the daemon left: its arguments name the home.
    const leftover = spawn(process.execPath, ["-e", "setTimeout(() => undefined, 300_000)", home], { detached: true, stdio: "ignore" });
    leftover.unref();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(leftover.pid as number)).toBe(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { stopTicketDaemons } = await import("./test-daemon-cleanup");
    await stopTicketDaemons("notes-app", "TR-90", "TR-90 is Done");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(leftover.pid as number)).toBe(false);
    expect(existsSync(home)).toBe(false);
    expect(existsSync(recordPath)).toBe(false);
    expect(existsSync(join(scratch, "calls.log"))).toBe(false);
    expect(log.mock.calls.map((call) => String(call[0]))).toEqual([`[taro] cleared TR-90's test daemon ${home} (port 6851), which no longer ran, because TR-90 is Done: killed ${leftover.pid}`]);
    log.mockRestore();
  });

  it("does nothing for a ticket with no recorded daemon", async () => {
    const { stopTicketDaemons } = await import("./test-daemon-cleanup");
    await stopTicketDaemons("notes-app", "TR-91", "TR-91 is Done");
    expect(existsSync(join(scratch, "calls.log"))).toBe(false);
  });
});

/** A fresh path directly in /tmp, nothing there yet: removed after the test. */
const madePaths: string[] = [];
function freshTmp(prefix: string): string {
  const made = mkdtempSync(`/tmp/${prefix}`);
  rmSync(made, { recursive: true });
  madePaths.push(made);
  return made;
}

afterEach(() => {
  for (const path of madePaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("startTestDaemon refuses a home that is not a new throwaway folder (fake HOME, stub paseo)", () => {
  function setup(): { fakeHome: string; realHome: string; options: Parameters<typeof startTestDaemon>[0] } {
    const fakeHome = join(scratch, "user");
    const realHome = join(fakeHome, ".paseo");
    mkdirSync(realHome, { recursive: true });
    writeFileSync(join(realHome, "config.json"), "real\n");
    const options = { paseo: process.env.PASEO_CLI as string, recordPath: join(scratch, "records", "TR-90.json"), ticket: "TR-90", real: { userHome: fakeHome, paseoHome: null }, startedBy: null };
    return { fakeHome, realHome, options };
  }

  it("a /tmp/paseo-… link to the real home", async () => {
    const { realHome, options } = setup();
    const link = freshTmp("paseo-TR-90-link-");
    symlinkSync(realHome, link);
    await expect(startTestDaemon({ ...options, home: link })).rejects.toThrow(`real Paseo daemon's home (${realHome})`);
    expect(readFileSync(join(realHome, "config.json"), "utf8")).toBe("real\n");
    expect(existsSync(join(scratch, "calls.log"))).toBe(false);
  });

  it("a home under a linked parent that lands on the real home", async () => {
    const { fakeHome, realHome, options } = setup();
    const parent = freshTmp("paseo-TR-90-parent-");
    symlinkSync(fakeHome, parent);
    await expect(startTestDaemon({ ...options, home: join(parent, ".paseo") })).rejects.toThrow("real Paseo daemon's home");
    expect(readFileSync(join(realHome, "config.json"), "utf8")).toBe("real\n");
    expect(existsSync(join(scratch, "calls.log"))).toBe(false);
  });

  it("a link to the real home when the real home is itself reached through a link", async () => {
    const { fakeHome, options } = setup();
    const actual = join(scratch, "actual-paseo");
    mkdirSync(actual);
    symlinkSync(actual, join(fakeHome, "paseo-link"));
    const link = freshTmp("paseo-TR-90-link-");
    symlinkSync(actual, link);
    await expect(startTestDaemon({ ...options, real: { userHome: fakeHome, paseoHome: join(fakeHome, "paseo-link") }, home: link })).rejects.toThrow("real Paseo daemon's home");
    expect(existsSync(join(scratch, "calls.log"))).toBe(false);
  });

  it("a link elsewhere, and a folder already holding files", async () => {
    const { options } = setup();
    const link = freshTmp("paseo-TR-90-link-");
    const elsewhere = join(scratch, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, link);
    await expect(startTestDaemon({ ...options, home: link })).rejects.toThrow("symbolic link");
    const full = freshTmp("paseo-TR-90-full-");
    mkdirSync(full);
    writeFileSync(join(full, "notes.txt"), "mine\n");
    await expect(startTestDaemon({ ...options, home: full })).rejects.toThrow("already holds files");
    expect(readFileSync(join(full, "notes.txt"), "utf8")).toBe("mine\n");
    expect(existsSync(join(scratch, "calls.log"))).toBe(false);
  });
});

describe("a recorded daemon is stopped only while its pid is still it (start time)", () => {
  /** A process standing in for the daemon's supervisor: its own session, like Paseo's. */
  function sleeper(): number {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => undefined, 300_000)"], { detached: true, stdio: "ignore" });
    child.unref();
    return child.pid as number;
  }

  it("records the start time, then stops the daemon and kills its session", async () => {
    const pid = sleeper();
    // The stub plays `paseo daemon start`: it writes paseo.pid in the home it is given.
    writeFileSync(process.env.PASEO_CLI as string, `#!/bin/sh\necho "$@" >> "${join(scratch, "calls.log")}"\nif [ "$1" = daemon ] && [ "$2" = start ]; then echo '{"pid":${pid}}' > "$4/paseo.pid"; fi\n`);
    const target = freshTmp("paseo-TR-90-run-");
    const recordPath = join(scratch, "records", "TR-90.json");
    const record = await startTestDaemon({ paseo: process.env.PASEO_CLI as string, recordPath, ticket: "TR-90", real: { userHome: join(scratch, "user"), paseoHome: null }, home: target, startedBy: null });
    // The start time is ps's, as on macOS, which has no /proc.
    const lstart = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { env: { ...process.env, LC_ALL: "C" }, encoding: "utf8" }).stdout.trim().replace(/\s+/g, " ");
    expect(lstart).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d\d:\d\d:\d\d \d{4}$/);
    expect(record).toMatchObject({ pid, startTime: lstart });
    const [stopped] = await stopTestDaemons({ paseo: process.env.PASEO_CLI as string, recordPath });
    expect(stopped).toMatchObject({ outcome: "stopped", killed: [pid] });
    expect(readFileSync(join(scratch, "calls.log"), "utf8")).toContain(`daemon stop --home ${target} --force`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(pid)).toBe(false);
  });

  it("spares a reused pid named Paseo Daemon whose start time differs, and keeps a record without a start time while its pid runs", async () => {
    // exec -a gives the process Paseo's name, as a later daemon that got the pid would have.
    const child = spawn("bash", ["-c", "exec -a 'Paseo Daemon' sleep 300"], { detached: true, stdio: "ignore" });
    child.unref();
    const pid = child.pid as number;
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const recordPath = join(scratch, "records", "TR-90.json");
      mkdirSync(join(recordPath, ".."), { recursive: true });
      const reused = freshTmp("paseo-TR-90-old-");
      const unknown = freshTmp("paseo-TR-90-older-");
      mkdirSync(reused);
      mkdirSync(unknown);
      const records = [
        { home: reused, port: 6851, pid, startTime: "Thu Jan  1 00:00:00 1970", startedAt: "2026-11-12T07:00:00.000Z", startedBy: null },
        { home: unknown, port: 6852, pid, startedAt: "2026-11-12T07:00:00.000Z", startedBy: null },
      ];
      writeFileSync(recordPath, JSON.stringify(records));
      const stopped = await stopTestDaemons({ paseo: process.env.PASEO_CLI as string, recordPath });
      expect(stopped.map((each) => [each.outcome, each.killed])).toEqual([
        ["not-running", []],
        ["kept", []],
      ]);
      expect(stopped[1]?.problems.join()).toContain("start time was not read");
      expect(existsSync(join(scratch, "calls.log"))).toBe(false);
      expect(alive(pid)).toBe(true);
      expect([existsSync(reused), existsSync(unknown)]).toEqual([false, true]);
      expect((await readDaemonRecords(recordPath)).map((record) => record.home)).toEqual([unknown]);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  });
});

describe("a daemon whose start time ps cannot read (stub ps)", () => {
  it("is recorded without one, then kept with its home, the log saying nothing was stopped", async () => {
    // A ps that lists processes but cannot print a start time, as a ps without lstart would.
    const bin = join(scratch, "bin");
    mkdirSync(bin);
    const realPs = spawnSync("sh", ["-c", "command -v ps"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(bin, "ps"), `#!/bin/sh\ncase "$*" in *lstart*) echo "ps: lstart: keyword not found" >&2; exit 1;; esac\nexec ${realPs} "$@"\n`);
    chmodSync(join(bin, "ps"), 0o755);
    const pid = spawnDetachedSleeper();
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ""}`;
    try {
      writeFileSync(process.env.PASEO_CLI as string, `#!/bin/sh\necho "$@" >> "${join(scratch, "calls.log")}"\nif [ "$1" = daemon ] && [ "$2" = start ]; then echo '{"pid":${pid}}' > "$4/paseo.pid"; fi\n`);
      const target = freshTmp("paseo-TR-90-nops-");
      const recordPath = daemonRecordPath(join(process.env.PASEO_HOME as string, "plugin-data", "taro"), "notes-app", "TR-90");
      const record = await startTestDaemon({ paseo: process.env.PASEO_CLI as string, recordPath, ticket: "TR-90", real: { userHome: join(scratch, "user"), paseoHome: null }, home: target, startedBy: null });
      expect(record).toMatchObject({ pid, startTime: null });
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const { stopTicketDaemons } = await import("./test-daemon-cleanup");
      await stopTicketDaemons("notes-app", "TR-90", "TR-90 is Done");
      const lines = log.mock.calls.map((call) => String(call[0]));
      log.mockRestore();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(new RegExp(`^\\[taro\\] did not stop TR-90's test daemon ${target} \\(port \\d+\\) because TR-90 is Done: stopped nothing; kept: its start time was not read`));
      expect(alive(pid)).toBe(true);
      expect(existsSync(join(target, "config.json"))).toBe(true);
      expect(await readDaemonRecords(recordPath)).toEqual([record]);
      expect(readFileSync(join(scratch, "calls.log"), "utf8")).not.toContain("daemon stop");
    } finally {
      process.env.PATH = previousPath;
      process.kill(pid, "SIGKILL");
    }
  });
});

function spawnDetachedSleeper(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => undefined, 300_000)"], { detached: true, stdio: "ignore" });
  child.unref();
  return child.pid as number;
}
