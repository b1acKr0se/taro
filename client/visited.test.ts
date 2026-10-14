import { describe, expect, it } from "vitest";

import { withVisited } from "./visited";

describe("withVisited", () => {
  it("adds a pane the first time it shows", () => {
    expect([...withVisited(new Set(["manager"]), "board")]).toEqual(["manager", "board"]);
  });

  it("returns the same set when a visited pane shows again, so switching back mounts nothing", () => {
    const visited = new Set(["manager", "board"]);
    expect(withVisited(visited, "manager")).toBe(visited);
  });

  it("returns the same set when nothing shows", () => {
    const visited = new Set(["manager"]);
    expect(withVisited(visited, null)).toBe(visited);
  });

  it("never drops a pane: one shown once stays however many switches follow", () => {
    let visited: ReadonlySet<string> = new Set();
    ["manager", "inbox", "board", "manager", "stats", "inbox"].forEach((tab) => {
      visited = withVisited(visited, tab);
    });
    expect([...visited].sort()).toEqual(["board", "inbox", "manager", "stats"]);
  });
});
