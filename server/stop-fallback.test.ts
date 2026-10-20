/** `stopAgent` (TR-201): the daemon's websocket first, `paseo stop` only when that route cannot be used. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { stopAgent } from "./cli";
import { cancelOverSocket, DaemonCancelError, DirectCancelUnavailable } from "./daemon-cancel";
import { runCommand } from "./process";

vi.mock("./daemon-cancel", async (original) => ({ ...(await original<typeof import("./daemon-cancel")>()), cancelOverSocket: vi.fn() }));
vi.mock("./process", async (original) => ({ ...(await original<typeof import("./process")>()), runCommand: vi.fn(async () => ({ code: 0, stdout: "{}", stderr: "" })) }));
vi.mock("node:fs/promises", async (original) => ({ ...(await original<typeof import("node:fs/promises")>()), access: vi.fn(async () => undefined) }));

const AGENT = "3f2a9c1d-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.mocked(cancelOverSocket).mockReset();
  vi.mocked(runCommand).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("stopAgent", () => {
  it("stops over the websocket without starting the CLI", async () => {
    vi.mocked(cancelOverSocket).mockResolvedValueOnce(undefined);
    await stopAgent(AGENT);
    expect(vi.mocked(cancelOverSocket).mock.calls[0]?.[0]).toBe(AGENT);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("falls back to `paseo stop <id>` when the websocket cannot be used", async () => {
    vi.mocked(cancelOverSocket).mockRejectedValueOnce(new DirectCancelUnavailable("no local credential in the daemon's home"));
    await stopAgent(AGENT);
    expect(vi.mocked(runCommand).mock.calls[0]?.[1]?.slice(0, 2)).toEqual(["stop", AGENT]);
  });

  it("surfaces the daemon's refusal without trying the CLI", async () => {
    vi.mocked(cancelOverSocket).mockRejectedValueOnce(new DaemonCancelError("Agent is busy replacing"));
    await expect(stopAgent(AGENT)).rejects.toThrow("Agent is busy replacing");
    expect(runCommand).not.toHaveBeenCalled();
  });
});
