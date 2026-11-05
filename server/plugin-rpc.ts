/**
 * One of Taro's plugin RPCs from the `taro` command (TR-258), so a script does what a button does
 * through the same handler and the same checks. Straight over the daemon's websocket as
 * `daemon-cancel.ts` does: hello with the local credential, then `plugin.rpc.invoke.request`.
 * Every file reachable from `taro-cli.ts` is erasable TypeScript with Node builtins only.
 */
import { randomUUID } from "node:crypto";

import { errorText } from "../shared/error-text.ts";
import { daemonEndpoint, openNodeSocket, sessionMessage, type DaemonSocket } from "./daemon-cancel.ts";

export interface PluginRpcOptions {
  /** The daemon's home, holding `paseo.pid` and `local-credential`. */
  home: string;
  /** Opens a socket; null when the runtime has none. */
  open?: (url: string) => DaemonSocket | null;
  connectTimeoutMs?: number;
  /** An action such as Accept waits for a merge, so this is long. */
  answerTimeoutMs?: number;
}

/** The daemon could not be reached or did not answer: the action did not run (or its outcome is unknown, for a timeout). */
export class DaemonUnreachable extends Error {}

/** The handler refused or failed: its own message, as the button would show it. */
export class RpcRefused extends Error {}

const CONNECT_TIMEOUT_MS = 3_000;
const ANSWER_TIMEOUT_MS = 10 * 60_000;

export async function invokePluginRpc(method: string, input: unknown, options: PluginRpcOptions): Promise<unknown> {
  let endpoint: { url: string; token: string };
  try {
    endpoint = await daemonEndpoint(options.home);
  } catch (error) {
    throw new DaemonUnreachable(`Cannot reach the Paseo daemon in ${options.home}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const socket = (options.open ?? openNodeSocket)(endpoint.url);
  if (socket === null) throw new DaemonUnreachable("This Node has no WebSocket.");
  const requestId = `taro-cli-${randomUUID()}`;

  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let sent = false;
    let timer = setTimeout(() => finish(new DaemonUnreachable("The daemon did not answer the hello in time."), undefined), options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);

    function finish(error: Error | null, output: unknown): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
      if (error === null) resolve(output);
      else reject(error);
    }

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "hello", clientId: `taro-cli-${randomUUID()}`, clientType: "cli", protocolVersion: 1, auth: { kind: "localCredential", token: endpoint.token } }));
    };
    socket.onmessage = (event) => {
      const message = sessionMessage(event.data);
      if (message === null) return;
      const payload = typeof message.payload === "object" && message.payload !== null ? message.payload : {};
      if (!sent && message.type === "status" && Reflect.get(payload, "status") === "server_info") {
        sent = true;
        clearTimeout(timer);
        timer = setTimeout(() => finish(new DaemonUnreachable("The daemon did not answer in time; check the ticket before running it again."), undefined), options.answerTimeoutMs ?? ANSWER_TIMEOUT_MS);
        socket.send(JSON.stringify({ type: "session", message: { type: "plugin.rpc.invoke.request", requestId, pluginId: "taro", method, input } }));
        return;
      }
      if (Reflect.get(payload, "requestId") !== requestId) return;
      if (message.type === "rpc_error") {
        const reason: unknown = Reflect.get(payload, "error");
        finish(new RpcRefused(typeof reason === "string" && reason.trim() !== "" ? errorText(reason) : "The daemon refused the action."), undefined);
      } else if (message.type === "plugin.rpc.invoke.response") {
        finish(null, Reflect.get(payload, "output"));
      }
    };
    socket.onerror = () => finish(new DaemonUnreachable("The websocket to the daemon failed."), undefined);
    socket.onclose = () => finish(new DaemonUnreachable("The daemon closed the websocket before answering."), undefined);
  });
}
