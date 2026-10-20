/**
 * Stopping a turn straight over the daemon's websocket (TR-201), as Paseo's app and CLI do: the
 * plugin SDK offers no cancel, and starting `paseo stop` costs about a second, most of it Node
 * loading the CLI. One short connection per stop: the address from the daemon's lock file
 * (`paseo.pid`), the `localCredential` hello from its `local-credential` file, then
 * `cancel_agent_request`. Both files and the messages are Paseo's, undocumented: anything here
 * that does not answer as expected says so, and the caller stops the turn through the CLI instead.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The part of a WebSocket this uses: Node's global one, or a fake in tests. */
export interface DaemonSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface DirectCancelOptions {
  /** The daemon's home, holding `paseo.pid` and `local-credential`. */
  home: string;
  /** Opens a socket; null when the runtime has none. */
  open?: (url: string) => DaemonSocket | null;
  /** For connecting and the daemon's hello answer; past it the CLI is quicker to try. */
  connectTimeoutMs?: number;
  /** For the daemon's answer to the cancel, which waits for the turn to settle. */
  answerTimeoutMs?: number;
}

/** The daemon's refusal, from its answer, or no answer to a cancel it has: the CLI would fare no better, so it is not tried. */
export class DaemonCancelError extends Error {}

/** The direct route could not be used or did not answer; the reason is for the log. */
export class DirectCancelUnavailable extends Error {}

const CONNECT_TIMEOUT_MS = 3_000;
const ANSWER_TIMEOUT_MS = 30_000;
/** One client id per plugin process, so the daemon resumes one session rather than keeping one per stop. */
const CLIENT_ID = `taro-plugin-${randomUUID()}`;
const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/;

/**
 * The websocket URL for the daemon's `listen` value: `host:port` or a bare port. A unix socket, a
 * named pipe or anything else gives null, as Node's WebSocket cannot reach them.
 */
export function daemonSocketUrl(listen: unknown): string | null {
  if (typeof listen !== "string") return null;
  const value = listen.trim();
  if (/^\d+$/.test(value)) return `ws://127.0.0.1:${value}/ws`;
  const bracketed = /^\[([0-9a-fA-F:.]+)\]:(\d+)$/.exec(value);
  if (bracketed !== null) return `ws://[${bracketed[1] === "::" ? "::1" : bracketed[1]}]:${bracketed[2]}/ws`;
  const plain = /^([A-Za-z0-9.-]+):(\d+)$/.exec(value);
  if (plain === null) return null;
  // A daemon listening on every interface is reached on loopback, where its local credential holds.
  return `ws://${plain[1] === "0.0.0.0" ? "127.0.0.1" : plain[1]}:${plain[2]}/ws`;
}

function openNodeSocket(url: string): DaemonSocket | null {
  const Socket = (globalThis as { WebSocket?: new (url: string) => DaemonSocket }).WebSocket;
  return Socket === undefined ? null : new Socket(url);
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** A session message's inner message, or null for anything else. */
function sessionMessage(data: unknown): { type?: unknown; payload?: unknown } | null {
  try {
    const parsed: unknown = JSON.parse(String(data));
    if (typeof parsed !== "object" || parsed === null || Reflect.get(parsed, "type") !== "session") return null;
    const message: unknown = Reflect.get(parsed, "message");
    return typeof message === "object" && message !== null ? (message as { type?: unknown; payload?: unknown }) : null;
  } catch {
    return null;
  }
}

/**
 * Ends the agent's turn through the daemon's websocket. Resolves once the daemon answered that it
 * did (or that no turn was running); throws `DaemonCancelError` when the daemon refused, and
 * `DirectCancelUnavailable` when this route could not be used, so the caller tries the CLI.
 */
export async function cancelOverSocket(agentId: string, options: DirectCancelOptions): Promise<void> {
  const lockText = await readText(join(options.home, "paseo.pid"));
  let listen: unknown = null;
  try {
    listen = lockText === null ? null : Reflect.get(JSON.parse(lockText) as object, "listen");
  } catch {
    // A lock file mid-write or reshaped: the CLI finds the daemon its own way.
  }
  const url = daemonSocketUrl(listen);
  if (url === null) throw new DirectCancelUnavailable(`no websocket address in the daemon's lock file (${JSON.stringify(listen)})`);
  const token = (await readText(join(options.home, "local-credential")))?.trim() ?? "";
  if (!CREDENTIAL.test(token)) throw new DirectCancelUnavailable("no local credential in the daemon's home");
  const socket = (options.open ?? openNodeSocket)(url);
  if (socket === null) throw new DirectCancelUnavailable("this Node has no WebSocket");
  const requestId = `taro-stop-${randomUUID()}`;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let sent = false;
    let timer = setTimeout(() => finish(new DirectCancelUnavailable("the daemon did not answer the hello in time")), options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);

    function finish(error: Error | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
      if (error === null) resolve();
      else reject(error);
    }

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "hello", clientId: CLIENT_ID, clientType: "cli", protocolVersion: 1, auth: { kind: "localCredential", token } }));
    };
    socket.onmessage = (event) => {
      const message = sessionMessage(event.data);
      if (message === null) return;
      const payload = typeof message.payload === "object" && message.payload !== null ? message.payload : {};
      if (!sent && message.type === "status" && Reflect.get(payload, "status") === "server_info") {
        sent = true;
        clearTimeout(timer);
        // The daemon has the cancel: the CLI would only send it again and wait as long once more.
        timer = setTimeout(() => finish(new DaemonCancelError("The daemon did not confirm the stop in time.")), options.answerTimeoutMs ?? ANSWER_TIMEOUT_MS);
        socket.send(JSON.stringify({ type: "session", message: { type: "cancel_agent_request", agentId, requestId } }));
        return;
      }
      if (message.type !== "cancel_agent_response" || Reflect.get(payload, "requestId") !== requestId) return;
      const error: unknown = Reflect.get(payload, "error");
      finish(typeof error === "string" && error.trim() !== "" ? new DaemonCancelError(error.trim()) : null);
    };
    socket.onerror = () => finish(new DirectCancelUnavailable("the websocket failed"));
    socket.onclose = () => finish(new DirectCancelUnavailable("the daemon closed the websocket before answering"));
  });
}
