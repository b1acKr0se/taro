import { describe, expect, it } from "vitest";
import { commandEnvironment } from "./process.ts";

describe("commandEnvironment", () => {
  it("drops the launching agent's Paseo identity and keeps the rest", () => {
    const environment = commandEnvironment({ TARO_TRACKER: "/tmp/tracker" }, { PASEO_AGENT_ID: "a", PASEO_WORKSPACE_ID: "wks_1", PASEO_AGENT_CWD: "/x", PATH: "/usr/bin" });
    expect(environment).toEqual({ PATH: "/usr/bin", TARO_TRACKER: "/tmp/tracker" });
  });
});
