import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (page: string) => readFileSync(join(import.meta.dirname, page), "utf8").replace(/\s+/g, " ");

describe("parallel children in the skill pages", () => {
  it("lets children run at once only with no dependency, disjoint Owns and example interfaces", () => {
    const build = read("phases/build.md");
    expect(build).toContain("unless Parts shows no dependency between them, their Owns are disjoint and each interface has an example");
    expect(read("levels/high.md")).toContain("no dependency between them, disjoint Owns and example interfaces run at once");
  });

  it("starts each with the worktree option on the child's branch, within the thread check", () => {
    const build = read("phases/build.md");
    expect(build).toContain("taro agent start <job> <child id> … --worktree");
    expect(build).toContain("taro/<child id>");
    expect(build).toContain("only as many as the thread check allows");
  });

  it("makes a child whose tests run another child's code wait, and merges verified children in Parts order", () => {
    const build = read("phases/build.md");
    expect(build).toContain("A child whose tests run another child's code waits for it");
    expect(build).toContain("Merge each into your branch once verified, in Parts order");
  });
});
