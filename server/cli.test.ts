import { describe, expect, it } from "vitest";

import { paseoJsonError } from "./cli";
import { main } from "./taro-cli.ts";

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

describe("taro --help", () => {
  it("help lists card commands", async () => {
    let stdout = "";
    const code = await main(["--help"], { stdout: (text) => void (stdout += text), stderr: () => undefined, env: {} });
    expect(code).toBe(0);
    for (const line of [
      "taro card ask <ID> [--host <name>] --file <json|->",
      "taro card answer <ID> <cardId> [--label <option>] [--text <words>]",
      "taro card withdraw <ID> <cardId>",
      "taro card show <ID> [<cardId>] [--json] [--wait <seconds>]",
      "taro agent record <ID> implementer|reviewer|researcher|other --name <name> [--task <doing what>] [--host <name>]",
      "taro agent finish <ID> <name> --state done|failed",
      "--project <name>",
    ]) {
      expect(stdout).toContain(line);
    }
  });
});
