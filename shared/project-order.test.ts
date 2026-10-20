import { describe, expect, it } from "vitest";

import { moveProject, orderProjects } from "./project-order";

const project = (name: string, createdMs: number) => ({ name, createdMs });
const names = (list: { name: string }[]) => list.map((entry) => entry.name);

describe("orderProjects", () => {
  it("puts the newest project on the left when nothing is saved", () => {
    expect(names(orderProjects([project("a", 1), project("c", 3), project("b", 2)], []))).toEqual(["c", "b", "a"]);
  });

  it("breaks a tie in creation time by name", () => {
    expect(names(orderProjects([project("b", 0), project("a", 0)], []))).toEqual(["a", "b"]);
  });

  it("follows the saved order, ignoring creation time", () => {
    expect(names(orderProjects([project("a", 1), project("b", 2), project("c", 3)], ["a", "c", "b"]))).toEqual(["a", "c", "b"]);
  });

  it("puts a project the saved order lacks on the left, newest first", () => {
    expect(names(orderProjects([project("a", 1), project("b", 2), project("n1", 5), project("n2", 6)], ["b", "a"]))).toEqual(["n2", "n1", "b", "a"]);
  });

  it("drops a saved name with no project and tolerates a repeated name", () => {
    expect(names(orderProjects([project("a", 1), project("b", 2)], ["gone", "b", "b", "a"]))).toEqual(["b", "a"]);
  });

  it("handles no projects", () => {
    expect(orderProjects([], ["a"])).toEqual([]);
  });
});

describe("moveProject", () => {
  it("moves a name to the front, the middle and the end", () => {
    expect(moveProject(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveProject(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveProject(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  });

  it("clamps an index out of range and leaves an unknown name alone", () => {
    expect(moveProject(["a", "b"], "a", 99)).toEqual(["b", "a"]);
    expect(moveProject(["a", "b"], "b", -4)).toEqual(["b", "a"]);
    expect(moveProject(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });
});
