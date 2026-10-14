import { describe, expect, it } from "vitest";

import { paseoJsonError } from "./cli";

describe("paseoJsonError", () => {
  it("reads the message of the CLI's JSON error, which it prints on stderr", () => {
    const json = JSON.stringify({ error: { code: "AGENT_NOT_FOUND", message: "Agent not found: no-such-agent", details: "Use \"paseo ls\"" } }, null, 2);
    expect(paseoJsonError({ code: 1, stdout: "", stderr: json })).toBe("Agent not found: no-such-agent");
    expect(paseoJsonError({ code: 1, stdout: json, stderr: "" })).toBe("Agent not found: no-such-agent");
  });

  it("falls back to the first line of output when there is no JSON message", () => {
    expect(paseoJsonError({ code: 1, stdout: "", stderr: "daemon not running\nhint" })).toBe("daemon not running");
    expect(paseoJsonError({ code: 1, stdout: "{\"error\":{}}", stderr: "" })).toBe("{\"error\":{}}");
    expect(paseoJsonError({ code: 2, stdout: "", stderr: "" })).toBe("exit 2");
  });
});
