import { describe, expect, it } from "vitest";

import { withRecent, withVisited } from "./visited";

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

describe("withRecent", () => {
  it("keeps the last projects shown, dropping the one shown longest ago", () => {
    let recent: readonly string[] = [];
    ["notes-app", "recipes", "budget", "photos"].forEach((project) => (recent = withRecent(recent, project, 3)));
    expect(recent).toEqual(["recipes", "budget", "photos"]);
  });

  it("moves a project shown again to the newest end, so it is not the next dropped", () => {
    const recent = withRecent(["notes-app", "recipes", "budget"], "notes-app", 3);
    expect(withRecent(recent, "photos", 3)).toEqual(["budget", "notes-app", "photos"]);
  });

  it("returns the same list when the newest is shown again or nothing is", () => {
    const recent = ["notes-app", "recipes"];
    expect(withRecent(recent, "recipes", 3)).toBe(recent);
    expect(withRecent(recent, null, 3)).toBe(recent);
  });
});
