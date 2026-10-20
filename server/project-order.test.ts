import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectConfig } from "../shared/project";
import { inTabOrder, saveTabOrder } from "./project-order";

let home = "";
vi.mock("./config", () => ({ readGlobalConfig: async () => ({}), resolveTaroHome: () => home }));

const config = (project: string) => ({ project }) as ProjectConfig;
const names = (list: ProjectConfig[]) => list.map((entry) => entry.project);

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-order-"));
  // Folders made in this order; a later one is newer.
  for (const name of ["first", "second", "third"]) {
    await mkdir(join(home, "projects", name), { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("the tab order", () => {
  it("is newest first before anything is saved", async () => {
    expect(names(await inTabOrder([config("first"), config("third"), config("second")]))).toEqual(["third", "second", "first"]);
  });

  it("keeps a saved order, with a project made since on the left", async () => {
    await saveTabOrder(["first", "second"]);
    expect(names(await inTabOrder([config("first"), config("second"), config("third")]))).toEqual(["third", "first", "second"]);
  });

  it("falls back to the default when the saved file is damaged", async () => {
    await writeFile(join(home, "project-order.json"), "{not json", "utf8");
    expect(names(await inTabOrder([config("first"), config("second")]))).toEqual(["second", "first"]);
  });

  it("saves a repeated name once", async () => {
    await saveTabOrder(["second", "second", "first"]);
    expect(names(await inTabOrder([config("first"), config("second"), config("third")]))).toEqual(["third", "second", "first"]);
  });
});
