import { describe, expect, it } from "vitest";

import { daemonCleanupPlan, daemonLeftovers, daemonTargetRefusal, isThrowawayHome, parseDaemonRecords, parseProcessTable, type DaemonRecord, type ProcessEntry } from "./test-daemons";

const HOME = "/tmp/paseo-TR-12-a1b2c3";
const REAL = { userHome: "/home/user", paseoHome: null };

function record(overrides: Partial<DaemonRecord> = {}): DaemonRecord {
  return { home: HOME, port: 6851, pid: 500, startedAt: "2026-11-12T07:00:00.000Z", startedBy: null, ...overrides };
}

function entry(pid: number, ppid: number, sid: number, args: string, pgid = sid): ProcessEntry {
  return { pid, ppid, pgid, sid, args };
}

/** A running daemon as `ps` shows it: the supervisor leads a session its children share. */
const RUNNING: ProcessEntry[] = [
  entry(1, 0, 1, "/sbin/init"),
  entry(500, 1, 500, "Paseo Supervisor"),
  entry(501, 500, 500, "Paseo Daemon"),
  entry(502, 501, 500, "/usr/bin/node terminal-worker-process.js"),
  entry(900, 1, 900, "Paseo Supervisor"),
  entry(901, 900, 900, "Paseo Daemon"),
  entry(700, 1, 700, "bash"),
  entry(701, 700, 700, "taro daemon stop TR-12"),
];

describe("parseProcessTable", () => {
  it("reads pid, ppid, pgid, sid and the arguments, skipping what is not a row", () => {
    expect(parseProcessTable("  500     1   500   500 Paseo Supervisor\n  502   501   500   500 /usr/bin/node a b\n\ngarbage\n")).toEqual([
      entry(500, 1, 500, "Paseo Supervisor"),
      entry(502, 501, 500, "/usr/bin/node a b"),
    ]);
  });
});

describe("daemonCleanupPlan", () => {
  it("stops a running daemon first, then kills its whole session, never another daemon or the caller", () => {
    const [step] = daemonCleanupPlan([record()], RUNNING, 701);
    expect(step).toMatchObject({ stop: true, kill: [500, 501, 502], removeHome: true });
  });

  it("kills what a daemon whose pid is gone left in its session, a git reparented to PID 1 included, without asking it to stop", () => {
    const left = [entry(1, 0, 1, "/sbin/init"), entry(640, 1, 500, "git fetch origin"), entry(641, 640, 500, "git-remote-https origin"), entry(700, 1, 700, "bash")];
    const [step] = daemonCleanupPlan([record()], left, 700);
    expect(step).toMatchObject({ stop: false, kill: [640, 641], removeHome: true });
  });

  it("leaves a reused pid's session alone and kills only what names the home", () => {
    const reused = [entry(500, 1, 500, "postgres: main"), entry(510, 500, 500, "postgres: writer"), entry(600, 1, 600, `node plugin.js --data ${HOME}/plugins`)];
    const [step] = daemonCleanupPlan([record()], reused, 1234);
    expect(step).toMatchObject({ stop: false, kill: [600] });
  });

  it("never kills the process that stops it, nor its parents, even inside the daemon's session", () => {
    // An agent of the test daemon stopping it: its own stop ends the rest.
    const inside = [...RUNNING.slice(0, 4), entry(503, 501, 500, "claude"), entry(504, 503, 500, "taro daemon stop TR-12")];
    expect(daemonLeftovers(record(), inside, 504)).toEqual([502]);
  });

  it("deletes only a throwaway home", () => {
    expect(daemonCleanupPlan([record({ home: "/home/user/test-home" })], [], 1)[0]?.removeHome).toBe(false);
  });
});

describe("daemonTargetRefusal", () => {
  it("refuses the real daemon's port and home, and any home outside /tmp/paseo-…", () => {
    expect(daemonTargetRefusal({ home: HOME, port: 6767 }, REAL)).toContain("6767");
    expect(daemonTargetRefusal({ home: "/home/user/.paseo", port: 6851 }, REAL)).toContain("real Paseo daemon's home");
    expect(daemonTargetRefusal({ home: "/home/user/.paseo/x", port: 6851 }, REAL)).toContain("real Paseo daemon's home");
    expect(daemonTargetRefusal({ home: "/srv/paseo", port: 6851 }, { userHome: "/home/user", paseoHome: "/srv/paseo" })).toContain("/srv/paseo");
    expect(daemonTargetRefusal({ home: "/home/user/scratch", port: 6851 }, REAL)).toContain("not a throwaway home");
    expect(daemonTargetRefusal({ home: HOME, port: 6851 }, REAL)).toBeNull();
  });

  it("knows a throwaway home", () => {
    expect(isThrowawayHome("/tmp/paseo-TR-12")).toBe(true);
    expect(isThrowawayHome("/tmp/paseo-TR-12/")).toBe(true);
    expect(isThrowawayHome("/tmp/paseo-../etc")).toBe(false);
    expect(isThrowawayHome("/tmp")).toBe(false);
    expect(isThrowawayHome("/tmp/other")).toBe(false);
  });
});

describe("parseDaemonRecords", () => {
  it("reads the records and drops what is not one", () => {
    expect(parseDaemonRecords(JSON.stringify([record(), { home: 3 }, record({ pid: null })]))).toEqual([record(), record({ pid: null })]);
    expect(parseDaemonRecords("not json")).toEqual([]);
    expect(parseDaemonRecords(null)).toEqual([]);
  });
});
