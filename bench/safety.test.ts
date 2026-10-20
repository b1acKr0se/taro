import { describe, expect, it } from "vitest";

import { assertSafeHome, assertSafePort } from "./safety.ts";

describe("assertSafePort", () => {
  it("refuses the real daemon's port", () => {
    expect(() => assertSafePort(6767)).toThrow(/real Paseo daemon/);
  });
  it("refuses a port outside 6810-6899", () => {
    expect(() => assertSafePort(6809)).toThrow(/6810-6899/);
    expect(() => assertSafePort(6900)).toThrow(/6810-6899/);
    expect(() => assertSafePort(Number.NaN)).toThrow();
  });
  it("accepts a port in the range", () => {
    expect(() => assertSafePort(6810)).not.toThrow();
    expect(() => assertSafePort(6899)).not.toThrow();
  });
});

describe("assertSafeHome", () => {
  const home = "/home/someone";
  it("refuses a home under ~/.paseo, or the real one", () => {
    expect(() => assertSafeHome("/home/someone/.paseo", home, "/tmp")).toThrow(/real daemon/);
    expect(() => assertSafeHome("/home/someone/.paseo/worktrees/x", home, "/tmp")).toThrow(/real daemon/);
    expect(() => assertSafeHome("/root/.paseo/plugin-data", home, "/tmp")).toThrow(/real daemon/);
  });
  it("refuses an empty or relative path", () => {
    expect(() => assertSafeHome("", home, "/tmp")).toThrow(/empty/);
    expect(() => assertSafeHome("  ", home, "/tmp")).toThrow(/empty/);
    expect(() => assertSafeHome("taro-bench-x", home, "/tmp")).toThrow(/relative/);
    expect(() => assertSafeHome("../tmp/taro-bench-x", home, "/tmp")).toThrow(/relative/);
  });
  it("refuses the home, the root, the temporary folder and folders that are not the benchmark's", () => {
    expect(() => assertSafeHome(home, home, "/tmp")).toThrow(/not a folder of its own/);
    expect(() => assertSafeHome("/", home, "/tmp")).toThrow(/not a folder of its own/);
    expect(() => assertSafeHome("/tmp", home, "/tmp")).toThrow(/not a folder of its own/);
    expect(() => assertSafeHome("/tmp/other", home, "/tmp")).toThrow(/taro-bench-/);
    expect(() => assertSafeHome("/var/taro-bench-x", home, "/tmp")).toThrow(/taro-bench-/);
    expect(() => assertSafeHome("/tmp/taro-bench-x/inner", home, "/tmp")).toThrow(/taro-bench-/);
  });
  it("accepts a folder the benchmark made", () => {
    expect(() => assertSafeHome("/tmp/taro-bench-Ab12Cd", home, "/tmp")).not.toThrow();
  });
});
