import { describe, expect, it } from "vitest";

import { daemonCleanupPlan, daemonLeftovers, daemonTargetRefusal, isThrowawayHome, namesHome, parseDaemonRecords, parseProcessTable, procStartTime, realDaemonHomes, type DaemonRecord, type DaemonTarget, type ProcessEntry } from "./test-daemons";

const HOME = "/tmp/paseo-TR-12-a1b2c3";
const REAL = realDaemonHomes({ userHome: "/home/user", paseoHome: null });

function target(home: string, port = 6851, overrides: Partial<DaemonTarget> = {}): DaemonTarget {
  return { home, port, resolvedHome: home, kind: "missing", ...overrides };
}

function record(overrides: Partial<DaemonRecord> = {}): DaemonRecord {
  return { home: HOME, port: 6851, pid: 500, startTime: "4242", startedAt: "2026-11-12T07:00:00.000Z", startedBy: null, ...overrides };
}

function entry(pid: number, ppid: number, sid: number, args: string, pgid = sid, startTime?: string): ProcessEntry {
  return { pid, ppid, pgid, sid, args, ...(startTime === undefined ? {} : { startTime }) };
}

/** A running daemon as `ps` shows it: the supervisor leads a session its children share. */
const RUNNING: ProcessEntry[] = [
  entry(1, 0, 1, "/sbin/init"),
  entry(500, 1, 500, "Paseo Supervisor", 500, "4242"),
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

  it("spares a reused pid that is another Paseo daemon: its start time differs", () => {
    const other = [entry(1, 0, 1, "/sbin/init"), entry(500, 1, 500, "Paseo Daemon", 500, "9999"), entry(501, 500, 500, "/usr/bin/node terminal-worker-process.js")];
    expect(daemonCleanupPlan([record()], other, 1234)[0]).toMatchObject({ stop: false, kill: [] });
  });

  it("treats the session of a record without a start time as someone else's: kills only what names its home", () => {
    const old = record({ startTime: null });
    expect(daemonCleanupPlan([old], RUNNING, 701)[0]).toMatchObject({ stop: false, kill: [] });
    const gone = [entry(1, 0, 1, "/sbin/init"), entry(640, 1, 500, "git fetch origin"), entry(600, 1, 600, `node plugin.js --data ${HOME}/plugins`)];
    expect(daemonCleanupPlan([old], gone, 1234)[0]).toMatchObject({ stop: false, kill: [600] });
  });

  it("matches a home only up to a path boundary: TR-1's home is not TR-12's", () => {
    const processes = [
      entry(600, 1, 600, "node plugin.js --data /tmp/paseo-TR-1/plugins"),
      entry(601, 1, 601, "paseo daemon run --home /tmp/paseo-TR-1"),
      entry(602, 1, 602, "paseo daemon run --home /tmp/paseo-TR-1 --port 6851"),
      entry(603, 1, 603, "paseo daemon run --home /tmp/paseo-TR-12"),
      entry(604, 1, 604, "node plugin.js --data /tmp/paseo-TR-1-abc/plugins"),
    ];
    expect(daemonLeftovers(record({ home: "/tmp/paseo-TR-1/", pid: null, startTime: null }), processes, 1)).toEqual([600, 601, 602]);
    expect(namesHome("--home /tmp/paseo-TR-12", "/tmp/paseo-TR-1")).toBe(false);
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
    expect(daemonTargetRefusal(target(HOME, 6767), REAL)).toContain("6767");
    expect(daemonTargetRefusal(target("/home/user/.paseo"), REAL)).toContain("real Paseo daemon's home");
    expect(daemonTargetRefusal(target("/home/user/.paseo/x"), REAL)).toContain("real Paseo daemon's home");
    expect(daemonTargetRefusal(target("/srv/paseo"), realDaemonHomes({ userHome: "/home/user", paseoHome: "/srv/paseo" }))).toContain("/srv/paseo");
    expect(daemonTargetRefusal(target("/home/user/scratch"), REAL)).toContain("not a throwaway home");
    expect(daemonTargetRefusal(target(HOME), REAL)).toBeNull();
    expect(daemonTargetRefusal(target(HOME, 6851, { kind: "empty" }), REAL)).toBeNull();
  });

  it("refuses a home that resolves into the real one, a link, or a folder already holding files", () => {
    expect(daemonTargetRefusal(target(HOME, 6851, { resolvedHome: "/home/user/.paseo", kind: "symlink" }), REAL)).toContain("real Paseo daemon's home (/home/user/.paseo)");
    expect(daemonTargetRefusal(target("/tmp/paseo-link/.paseo", 6851, { resolvedHome: "/home/user/.paseo" }), REAL)).toContain("real Paseo daemon's home");
    expect(daemonTargetRefusal(target(HOME, 6851, { resolvedHome: "/data/elsewhere", kind: "symlink" }), REAL)).toContain("symbolic link");
    expect(daemonTargetRefusal(target(HOME, 6851, { kind: "not-empty" }), REAL)).toContain("already holds files");
    expect(daemonTargetRefusal(target(HOME, 6851, { kind: "not-folder" }), REAL)).toContain("not a folder");
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
    // A record from before start times were kept.
    expect(parseDaemonRecords(JSON.stringify([{ home: HOME, port: 6851, pid: 500 }]))[0]?.startTime).toBeNull();
    expect(parseDaemonRecords("not json")).toEqual([]);
    expect(parseDaemonRecords(null)).toEqual([]);
  });
});

describe("procStartTime", () => {
  it("reads field 22, counting from the last parenthesis of a command that holds spaces and parentheses", () => {
    const rest = Array.from({ length: 50 }, (_, index) => String(index + 3)).join(" ");
    expect(procStartTime(`123 (Paseo (x) Daemon) ${rest}`)).toBe("22");
    expect(procStartTime("garbage")).toBeNull();
  });
});
