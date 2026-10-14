import { describe, expect, it } from "vitest";

import { cacheable, createTimelineCache } from "./timeline-cache";

describe("createTimelineCache", () => {
  it("gives back what was stored, and nothing for an agent never read", () => {
    const cache = createTimelineCache<string>(2);
    cache.set("a", "one");
    expect(cache.get("a")).toBe("one");
    expect(cache.get("b")).toBeUndefined();
  });

  it("replaces an agent's earlier read", () => {
    const cache = createTimelineCache<string>(2);
    cache.set("a", "one");
    cache.set("a", "two");
    expect(cache.get("a")).toBe("two");
    expect(cache.size()).toBe(1);
  });

  it("drops the least recently used agent past its capacity", () => {
    const cache = createTimelineCache<string>(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a");
    cache.set("c", "3");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("1");
    expect(cache.get("c")).toBe("3");
  });

  it("holds nothing at capacity zero", () => {
    const cache = createTimelineCache<string>(0);
    cache.set("a", "1");
    expect(cache.size()).toBe(0);
  });
});

describe("cacheable", () => {
  it("keeps a read without an error", () => {
    expect(cacheable({})).toBe(true);
    expect(cacheable({ error: null })).toBe(true);
    expect(cacheable({ error: "" })).toBe(true);
  });

  it("does not let a failed read replace the cached conversation", () => {
    expect(cacheable({ error: "agent not found" })).toBe(false);
  });
});

describe("createTimelineCache over a kept map", () => {
  it("gives a cache built on the same map the reads of the one before (TR-038)", () => {
    const values = new Map<string, string>();
    createTimelineCache<string>(2, values).set("a", "one");
    expect(createTimelineCache<string>(2, values).get("a")).toBe("one");
  });
});
