import { describe, expect, it } from "vitest";

import { keptMap, keptObject } from "./kept";

describe("keptObject", () => {
  it("starts from a copy of the defaults on a fresh root", () => {
    const root = {};
    const defaults = { tab: "manager" };
    keptObject(root, "copy", defaults).tab = "board";
    expect(defaults.tab).toBe("manager");
    expect(keptObject(root, "view", { tab: "manager", ticket: null as string | null })).toEqual({ tab: "manager", ticket: null });
  });

  it("gives a second evaluation what the first wrote", () => {
    const root = {};
    const first = keptObject(root, "view", { tab: "manager", ticket: null as string | null, hidden: false });
    first.tab = "board";
    first.ticket = "SH-12";
    first.hidden = true;
    const second = keptObject(root, "view", { tab: "manager", ticket: null as string | null, hidden: false });
    expect(second).toEqual({ tab: "board", ticket: "SH-12", hidden: true });
  });

  it("keeps a field set back to null", () => {
    const root = {};
    const first = keptObject(root, "view", { project: null as string | null });
    first.project = "shop";
    keptObject(root, "view", { project: null as string | null }).project = null;
    expect(keptObject(root, "view", { project: null as string | null }).project).toBeNull();
  });

  it("starts over a field whose type changed, and takes a new field's default", () => {
    const root = {};
    const first = keptObject(root, "view", { tab: "manager", count: 1 });
    first.tab = "board";
    first.count = 5;
    const second = keptObject(root, "view", { tab: 0, added: "yes" });
    expect(second).toEqual({ tab: 0, added: "yes" });
  });

  it("takes a primitive where the default is null, but not an object", () => {
    const root = {};
    keptObject(root, "view", { value: "text" as string | null, other: {} as object | null });
    expect(keptObject(root, "view", { value: null as string | null, other: null as object | null })).toEqual({ value: "text", other: null });
  });

  it("does not take null where the default is a string", () => {
    const root = {};
    keptObject(root, "view", { value: null as string | null });
    expect(keptObject(root, "view", { value: "manager" }).value).toBe("manager");
  });

  it("ignores a slot that holds no object", () => {
    const root = {};
    Reflect.set(root, Symbol.for("paseo.taro.view"), "junk");
    expect(keptObject(root, "view", { tab: "manager" })).toEqual({ tab: "manager" });
  });

  it("is one object for evaluations alive at once, as for Taro on two hosts", () => {
    const root = {};
    const first = keptObject(root, "view", { tab: "manager" });
    const second = keptObject(root, "view", { tab: "manager" });
    first.tab = "board";
    expect(second.tab).toBe("board");
  });

  it("keeps names apart", () => {
    const root = {};
    keptObject(root, "one", { tab: "a" }).tab = "b";
    expect(keptObject(root, "two", { tab: "a" }).tab).toBe("a");
  });
});

describe("keptMap", () => {
  it("is the same map for every evaluation, and a new one where none or junk is kept", () => {
    const root = {};
    const first = keptMap<string, number>(root, "cache");
    first.set("a", 1);
    expect(keptMap<string, number>(root, "cache").get("a")).toBe(1);
    Reflect.set(root, Symbol.for("paseo.taro.other"), {});
    expect(keptMap(root, "other").size).toBe(0);
  });
});
