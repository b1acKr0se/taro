/** Stopping a turn over the daemon's websocket (TR-201), against a fake socket and a scratch daemon home. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cancelOverSocket, daemonSocketUrl, DaemonCancelError, DirectCancelUnavailable, type DaemonSocket } from "./daemon-cancel";

const AGENT = "3f2a9c1d-0000-4000-8000-000000000001";
const TOKEN = "A".repeat(43);

let home = "";
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-daemon-cancel-"));
  await writeFile(join(home, "paseo.pid"), JSON.stringify({ pid: 1, listen: "127.0.0.1:6767" }));
  await writeFile(join(home, "local-credential"), `${TOKEN}\n`);
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** A socket that records what is sent and lets the test play the daemon. */
function fakeDaemon(answer: (sent: Record<string, unknown>, socket: FakeSocket) => void = () => {}) {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  return {
    sockets,
    urls,
    open(url: string): DaemonSocket {
      urls.push(url);
      const socket = fakeSocket(answer);
      sockets.push(socket);
      queueMicrotask(() => socket.onopen?.());
      return socket;
    },
  };
}

type FakeSocket = DaemonSocket & { sent: Record<string, unknown>[]; closed: boolean; reply(message: unknown): void };

function fakeSocket(answer: (sent: Record<string, unknown>, socket: FakeSocket) => void): FakeSocket {
  const socket: FakeSocket = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    sent: [],
    closed: false,
    send(data) {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      socket.sent.push(parsed);
      queueMicrotask(() => answer(parsed, socket));
    },
    close() {
      socket.closed = true;
    },
    reply(message) {
      socket.onmessage?.({ data: JSON.stringify({ type: "session", message }) });
    },
  };
  return socket;
}

const SERVER_INFO = { type: "status", payload: { status: "server_info", protocolVersion: 1 } };

/** The daemon as it answers: server_info after the hello, then the cancel's answer with `error`. */
function answering(error: string | null) {
  return fakeDaemon((sent, socket) => {
    if (sent.type === "hello") socket.reply(SERVER_INFO);
    const message = sent.message as { type?: string; requestId?: string } | undefined;
    if (message?.type === "cancel_agent_request") {
      // Another request's answer and a stream event first: neither ends this stop.
      socket.reply({ type: "agent_stream", payload: { agentId: AGENT, event: { type: "turn_canceled" } } });
      socket.reply({ type: "cancel_agent_response", payload: { requestId: "someone-else", agentId: AGENT, error: "not this one" } });
      socket.reply({ type: "cancel_agent_response", payload: { requestId: message.requestId, agentId: AGENT, agent: null, error } });
    }
  });
}

describe("daemonSocketUrl", () => {
  it("reaches a TCP listen address over ws, loopback for every interface", () => {
    expect(daemonSocketUrl("127.0.0.1:6767")).toBe("ws://127.0.0.1:6767/ws");
    expect(daemonSocketUrl("localhost:6871")).toBe("ws://localhost:6871/ws");
    expect(daemonSocketUrl("0.0.0.0:6767")).toBe("ws://127.0.0.1:6767/ws");
    expect(daemonSocketUrl("[::1]:6767")).toBe("ws://[::1]:6767/ws");
    expect(daemonSocketUrl("[::]:6767")).toBe("ws://[::1]:6767/ws");
    expect(daemonSocketUrl(" 6767 ")).toBe("ws://127.0.0.1:6767/ws");
  });

  it("gives up on what Node's WebSocket cannot reach or does not parse", () => {
    for (const listen of ["/run/paseo.sock", "unix:///run/paseo.sock", "\\\\.\\pipe\\paseo", "tcp://127.0.0.1:6767?password=x", "", "localhost", 6767, null, undefined, {}]) {
      expect(daemonSocketUrl(listen)).toBeNull();
    }
  });
});

describe("cancelOverSocket", () => {
  it("says hello with the local credential, waits for server_info, then asks to cancel this agent", async () => {
    const daemon = answering(null);
    await cancelOverSocket(AGENT, { home, open: daemon.open });
    expect(daemon.urls).toEqual(["ws://127.0.0.1:6767/ws"]);
    const [socket] = daemon.sockets;
    expect(socket?.sent[0]).toMatchObject({ type: "hello", clientType: "cli", protocolVersion: 1, auth: { kind: "localCredential", token: TOKEN } });
    expect(socket?.sent[1]).toMatchObject({ type: "session", message: { type: "cancel_agent_request", agentId: AGENT } });
    expect(socket?.sent).toHaveLength(2);
    expect(socket?.closed).toBe(true);
  });

  it("surfaces the daemon's refusal as its own error, so the CLI is not tried", async () => {
    const daemon = answering("Agent is busy replacing");
    const stopping = cancelOverSocket(AGENT, { home, open: daemon.open });
    await expect(stopping).rejects.toBeInstanceOf(DaemonCancelError);
    await expect(stopping).rejects.toThrow("Agent is busy replacing");
  });

  it("does not ask to cancel before the daemon accepted the hello", async () => {
    const daemon = fakeDaemon(() => {});
    const stopping = cancelOverSocket(AGENT, { home, open: daemon.open, connectTimeoutMs: 20 });
    await expect(stopping).rejects.toBeInstanceOf(DirectCancelUnavailable);
    expect(daemon.sockets[0]?.sent.map((sent) => sent.type)).toEqual(["hello"]);
    expect(daemon.sockets[0]?.closed).toBe(true);
  });

  it("is unavailable when the daemon closes the socket (a refused credential) or it fails", async () => {
    const closing = fakeDaemon((_sent, socket) => socket.onclose?.());
    await expect(cancelOverSocket(AGENT, { home, open: closing.open })).rejects.toBeInstanceOf(DirectCancelUnavailable);
    const failing = fakeDaemon((_sent, socket) => socket.onerror?.());
    await expect(cancelOverSocket(AGENT, { home, open: failing.open })).rejects.toBeInstanceOf(DirectCancelUnavailable);
  });

  it("is unavailable when the daemon never answers the cancel", async () => {
    const daemon = fakeDaemon((sent, socket) => {
      if (sent.type === "hello") socket.reply(SERVER_INFO);
    });
    await expect(cancelOverSocket(AGENT, { home, open: daemon.open, answerTimeoutMs: 20 })).rejects.toThrow("did not answer the stop in time");
  });

  it("ignores what is not a session message", async () => {
    const daemon = fakeDaemon((sent, socket) => {
      if (sent.type !== "hello") return;
      socket.onmessage?.({ data: "not json" });
      socket.onmessage?.({ data: JSON.stringify({ type: "pong" }) });
      socket.onmessage?.({ data: JSON.stringify({ type: "session", message: null }) });
    });
    await expect(cancelOverSocket(AGENT, { home, open: daemon.open, connectTimeoutMs: 20 })).rejects.toThrow("did not answer the hello in time");
  });

  it("is unavailable without a lock file, a TCP address, a well-formed credential or a WebSocket", async () => {
    const daemon = answering(null);
    await writeFile(join(home, "paseo.pid"), JSON.stringify({ pid: 1, listen: "/run/paseo.sock" }));
    await expect(cancelOverSocket(AGENT, { home, open: daemon.open })).rejects.toThrow("no websocket address");
    await writeFile(join(home, "paseo.pid"), "{half a lock");
    await expect(cancelOverSocket(AGENT, { home, open: daemon.open })).rejects.toThrow("no websocket address");
    await rm(join(home, "paseo.pid"));
    await expect(cancelOverSocket(AGENT, { home, open: daemon.open })).rejects.toThrow("no websocket address");
    await writeFile(join(home, "paseo.pid"), JSON.stringify({ pid: 1, listen: "127.0.0.1:6767" }));
    await writeFile(join(home, "local-credential"), "short\n");
    await expect(cancelOverSocket(AGENT, { home, open: daemon.open })).rejects.toThrow("no local credential");
    await rm(join(home, "local-credential"));
    await expect(cancelOverSocket(AGENT, { home, open: daemon.open })).rejects.toThrow("no local credential");
    await writeFile(join(home, "local-credential"), TOKEN);
    await expect(cancelOverSocket(AGENT, { home, open: () => null })).rejects.toThrow("no WebSocket");
    expect(daemon.sockets).toHaveLength(0);
  });
});
