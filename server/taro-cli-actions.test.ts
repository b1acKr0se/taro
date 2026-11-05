/** The buttons from the command line (TR-258): `taro ticket accept …` and the like reach the plugin's own RPCs over the daemon's websocket. */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptTicket,
  answerDecision,
  changeQueuedSpec,
  closeRound,
  dismissManagerQuestion,
  pauseTicket,
  relaunchOwner,
  reopenTicket,
  requestChanges,
  resumeTicket,
} from "../shared/contracts";
import { main } from "./taro-cli.ts";

const TOKEN = "A".repeat(43);
const SERVER_INFO = { type: "status", payload: { status: "server_info", protocolVersion: 1 } };

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-cli-actions-"));
  await writeFile(join(home, "paseo.pid"), JSON.stringify({ pid: 1, listen: "127.0.0.1:9" }));
  await writeFile(join(home, "local-credential"), `${TOKEN}\n`);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(home, { recursive: true, force: true });
});

interface Sent {
  method: string;
  input: unknown;
  hello: Record<string, unknown>;
}

/** Plays the daemon: the answer to an RPC is `reply(method)`; every request is recorded. */
function stubDaemon(reply: (method: string) => { output?: unknown; error?: string }): Sent[] {
  const requests: Sent[] = [];
  class FakeWebSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    hello: Record<string, unknown> = {};
    constructor() {
      queueMicrotask(() => this.onopen?.());
    }
    send(data: string) {
      const sent = JSON.parse(data) as Record<string, any>;
      if (sent.type === "hello") {
        this.hello = sent;
        queueMicrotask(() => this.say({ ...SERVER_INFO }));
        return;
      }
      const { requestId, method, input } = sent.message;
      requests.push({ method, input, hello: this.hello });
      const answer = reply(method);
      queueMicrotask(() => {
        this.say({ type: "rpc_error", payload: { requestId: "someone-else", error: "not this one" } });
        // Paseo wraps a handler's message as it does for the button.
        if (answer.error !== undefined) this.say({ type: "rpc_error", payload: { requestId, error: `Request failed: ${answer.error} requestType=plugin.rpc.invoke.request code=handler_error` } });
        else this.say({ type: "plugin.rpc.invoke.response", payload: { requestId, output: answer.output ?? {} } });
      });
    }
    say(message: unknown) {
      this.onmessage?.({ data: JSON.stringify({ type: "session", message }) });
    }
    close() {}
  }
  vi.stubGlobal("WebSocket", FakeWebSocket);
  return requests;
}

async function run(args: string[], env: Record<string, string> = {}, stdin = "") {
  let stdout = "";
  let stderr = "";
  const code = await main(args, {
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    env: { PASEO_HOME: home, TARO_PROJECT: "notes-app", ...env },
    readStdin: async () => stdin,
  });
  return { code, stdout, stderr };
}

describe("every button has a command that calls the same RPC with an input its contract accepts", () => {
  const cases: [string[], { name: string; input: { parse(value: unknown): unknown } }, Record<string, unknown>][] = [
    [["ticket", "accept", "TR-7"], acceptTicket, { project: "notes-app", ticket: "TR-7" }],
    [["ticket", "reopen", "TR-7", "--note", "check staging"], reopenTicket, { project: "notes-app", ticket: "TR-7", note: "check staging" }],
    [["ticket", "request-changes", "TR-7", "--text", "wider"], requestChanges, { project: "notes-app", ticket: "TR-7", text: "wider" }],
    [["ticket", "change-spec", "TR-7", "--text", "wider"], changeQueuedSpec, { project: "notes-app", ticket: "TR-7", text: "wider" }],
    [["ticket", "close-round", "TR-7"], closeRound, { project: "notes-app", ticket: "TR-7" }],
    [["ticket", "pause", "TR-7"], pauseTicket, { project: "notes-app", ticket: "TR-7" }],
    [["ticket", "resume", "TR-7"], resumeTicket, { project: "notes-app", ticket: "TR-7" }],
    [["ticket", "relaunch-owner", "TR-7"], relaunchOwner, { project: "notes-app", ticket: "TR-7" }],
    [["decision", "answer", "q1", "--label", "Approve"], answerDecision, { key: "q1", label: "Approve", text: "" }],
    [["decision", "answer", "q1", "--text", "per trade"], answerDecision, { key: "q1", label: null, text: "per trade" }],
    [["decision", "dismiss", "q1"], dismissManagerQuestion, { project: "notes-app", key: "q1" }],
  ];
  for (const [args, contract, expected] of cases) {
    it(args.join(" "), async () => {
      const requests = stubDaemon(() => ({ output: { message: "Done it." } }));
      const result = await run(args);
      expect(result).toEqual({ code: 0, stdout: "Done it.\n", stderr: "" });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe(contract.name);
      expect(requests[0]?.input).toEqual(expected);
      expect(() => contract.input.parse(requests[0]?.input)).not.toThrow();
      expect(requests[0]?.hello).toMatchObject({ clientType: "cli", auth: { kind: "localCredential", token: TOKEN } });
    });
  }
});

describe("taro ticket accept", () => {
  it("prints the gate's own refusal and exits 1", async () => {
    stubDaemon(() => ({ error: "TR-7 has no pull request link, so it cannot be accepted." }));
    const result = await run(["ticket", "accept", "TR-7"]);
    expect(result).toEqual({ code: 1, stdout: "", stderr: "TR-7 has no pull request link, so it cannot be accepted.\n" });
  });

  it("prints the daemon's answer as JSON", async () => {
    stubDaemon(() => ({ output: {} }));
    expect((await run(["ticket", "accept", "TR-7", "--json"])).stdout).toBe("{}\n");
  });

  it("exits 4 and says so when no daemon is running in the home", async () => {
    await rm(join(home, "paseo.pid"));
    const result = await run(["ticket", "accept", "TR-7"]);
    expect(result.code).toBe(4);
    expect(result.stderr).toContain("Cannot reach the Paseo daemon");
  });

  it("takes --project over $TARO_PROJECT and needs one of them", async () => {
    const requests = stubDaemon(() => ({ output: {} }));
    await run(["ticket", "accept", "TR-7", "--project", "other"]);
    expect(requests[0]?.input).toEqual({ project: "other", ticket: "TR-7" });
    const result = await run(["ticket", "accept", "TR-7"], { TARO_PROJECT: "" });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("No project");
  });
});

describe("words", () => {
  it("reopen reads the note from standard input with --note -", async () => {
    const requests = stubDaemon(() => ({ output: { message: "ok" } }));
    await run(["ticket", "reopen", "TR-7", "--note", "-"], {}, "check staging\n");
    expect(requests[0]?.input).toMatchObject({ note: "check staging" });
  });

  it("refuses empty words and an answer with neither option nor text, before calling the daemon", async () => {
    const requests = stubDaemon(() => ({ output: {} }));
    for (const args of [["ticket", "reopen", "TR-7"], ["ticket", "reopen", "TR-7", "--note", ""], ["ticket", "request-changes", "TR-7", "--text", "-"], ["decision", "answer", "q1"]]) {
      expect((await run(args)).code).toBe(2);
    }
    expect(requests).toEqual([]);
  });
});

describe("inside an agent session (TR-237)", () => {
  const AGENT = { PASEO_AGENT_ID: "3f2a9c1d-0000-4000-8000-000000000001" };

  it("refuses the user's actions without calling the daemon, exit 1", async () => {
    const requests = stubDaemon(() => ({ output: {} }));
    for (const args of [
      ["ticket", "accept", "TR-7"],
      ["ticket", "reopen", "TR-7", "--note", "x"],
      ["ticket", "request-changes", "TR-7", "--text", "x"],
      ["ticket", "change-spec", "TR-7", "--text", "x"],
      ["ticket", "close-round", "TR-7"],
      ["decision", "answer", "q1", "--label", "Approve"],
      ["decision", "dismiss", "q1"],
    ]) {
      const result = await run(args, AGENT);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.stderr).toContain("outside an agent session");
    }
    expect(requests).toEqual([]);
  });

  it("leaves pause, resume and relaunch-owner open, and runs the same verbs outside a session", async () => {
    const requests = stubDaemon(() => ({ output: {} }));
    for (const verb of ["pause", "resume", "relaunch-owner"]) expect((await run(["ticket", verb, "TR-7"], AGENT)).code).toBe(0);
    expect((await run(["ticket", "accept", "TR-7"])).code).toBe(0);
    expect(requests.map((request) => request.method)).toEqual(["taro.ticket.pause", "taro.ticket.resume", "taro.owner.relaunch", "taro.ticket.accept"]);
  });
});

describe("bin/taro", () => {
  it("lists the new verbs in --help and runs the guard under plain node type stripping", () => {
    const bin = resolve(import.meta.dirname, "..", "bin", "taro");
    expect(spawnSync(bin, ["--help"], { encoding: "utf8" }).stdout).toContain("taro ticket accept");
    const guarded = spawnSync(bin, ["ticket", "accept", "TR-7", "--project", "p"], { encoding: "utf8", env: { ...process.env, PASEO_AGENT_ID: "a1", PASEO_HOME: home } });
    expect(guarded.status).toBe(1);
    expect(guarded.stderr).toContain("outside an agent session");
    // No lock file in this home, so nothing is dialled (the lock file the other tests write names the real daemon's port).
    const down = spawnSync(bin, ["ticket", "pause", "TR-7", "--project", "p"], { encoding: "utf8", env: { ...process.env, PASEO_HOME: join(home, "no-daemon") } });
    expect(down.status).toBe(4);
  }, 30_000);
});
