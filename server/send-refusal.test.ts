import { describe, expect, it, vi } from "vitest";

import type { PaseoApi } from "./host-types";
import { sendFromPlugin, sendInterrupting, sendUserAnswer, sendWithoutInterrupting } from "./send";

function recordingPaseo() {
  const send = vi.fn(async () => {});
  const paseo = { agents: { ref: () => ({ send }) } } as unknown as PaseoApi;
  return { paseo, send };
}

describe("the last stop before Paseo (TR-232)", () => {
  it("never sends /clear, whichever way the user's words arrive", async () => {
    const { paseo, send } = recordingPaseo();
    await expect(sendWithoutInterrupting(paseo, "a", "/clear")).rejects.toThrow("/clear is not available in this plugin.");
    await expect(sendInterrupting(paseo, "a", " /clear now")).rejects.toThrow("/clear is not available in this plugin.");
    await expect(sendUserAnswer(paseo, "a", "/reset")).rejects.toThrow("/reset is not available in this plugin.");
    expect(send).not.toHaveBeenCalled();
  });

  it("sends everything else as before", async () => {
    const { paseo, send } = recordingPaseo();
    await sendWithoutInterrupting(paseo, "a", "don't /clear yet");
    await sendInterrupting(paseo, "a", "/compact");
    await sendFromPlugin(paseo, "a", "Please continue.");
    expect(send).toHaveBeenCalledTimes(3);
  });
});
