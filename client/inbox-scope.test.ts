import { describe, expect, it } from "vitest";

import type { StoredDecision } from "../shared/state";
import { decisionsOfProjects } from "./inbox-scope";

const decision = (project: string, id: string) => ({ project, id, key: `agent:${id}` }) as StoredDecision;
const summaries = (...names: string[]) => names.map((project) => ({ config: { project } }));

describe("decisionsOfProjects", () => {
  const open = [decision("alpha", "a1"), decision("beta", "b1"), decision("alpha", "a2"), decision("gamma", "c1")];

  it("lists only the open project's decisions on a phone: none for a project with none (TR-137)", () => {
    expect(decisionsOfProjects(open, summaries("alpha")).map((each) => each.id)).toEqual(["a1", "a2"]);
    expect(decisionsOfProjects(open.filter((each) => each.project !== "beta"), summaries("beta"))).toEqual([]);
  });

  it("lists every given project's decisions on desktop, in their order", () => {
    expect(decisionsOfProjects(open, summaries("alpha", "beta", "gamma")).map((each) => each.id)).toEqual(["a1", "b1", "a2", "c1"]);
  });

  it("lists nothing for no projects or no decisions", () => {
    expect(decisionsOfProjects(open, [])).toEqual([]);
    expect(decisionsOfProjects([], summaries("alpha"))).toEqual([]);
  });
});
