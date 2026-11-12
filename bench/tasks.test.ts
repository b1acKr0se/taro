import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tasksDirectory = join(dirname(fileURLToPath(import.meta.url)), "tasks");
const taskNames = readdirSync(tasksDirectory).filter((name) => statSync(join(tasksDirectory, name)).isDirectory());

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]));
}

/** The files the owner can see: the seed repository, the spec and the brief. */
function ownerView(task: string): string[] {
  return [...filesUnder(join(tasksDirectory, task, "repo")), join(tasksDirectory, task, "spec.md"), join(tasksDirectory, task, "brief.md")];
}

describe("the benchmark tasks", () => {
  it("include the three ported from superlite", () => {
    expect(taskNames).toEqual(expect.arrayContaining(["sitegen", "brownfield", "combo-planted"]));
  });

  taskNames.forEach((task) => {
    it(`${task} has its brief, spec, seed, hidden tests, test command and settings`, () => {
      const directory = join(tasksDirectory, task);
      ["brief.md", "spec.md", "test-command", "task.json"].forEach((name) => expect(statSync(join(directory, name)).isFile(), name).toBe(true));
      ["repo", "hidden"].forEach((name) => expect(statSync(join(directory, name)).isDirectory(), name).toBe(true));
      expect(readdirSync(join(directory, "hidden")).length).toBeGreaterThan(0);
      const settings = JSON.parse(readFileSync(join(directory, "task.json"), "utf8")) as { title?: unknown };
      expect(typeof settings.title).toBe("string");
      expect(readFileSync(join(directory, "test-command"), "utf8").trim()).not.toBe("");
    });
  });

  // The briefs say the specification is attached: it must be in the seed, as the owner has no other way to read it (TR-207.10's first sitegen run built from a README alone).
  it.each(["sitegen", "brownfield", "combo-planted"])("%s puts its specification in the seed as SPEC.md", (task) => {
    const directory = join(tasksDirectory, task);
    expect(readFileSync(join(directory, "repo", "SPEC.md"), "utf8")).toBe(readFileSync(join(directory, "spec.md"), "utf8"));
    expect(readFileSync(join(directory, "brief.md"), "utf8")).toContain("`SPEC.md`");
  });

  // planted_names_not_in_owner_view
  it.each(["sitegen", "brownfield", "combo-planted"])("%s shows the owner no hidden tests and no planted-defect answers", (task) => {
    ownerView(task).forEach((file) => {
      expect(file, "hidden tests inside the seed").not.toMatch(/\/repo\/hidden(_tests)?\//);
      if (file.includes("/vendor/")) return;
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/planted_|fixes\.patch|PLANTED/);
    });
  });

  it("combo-planted keeps its answers beside, not inside, the seed", () => {
    const directory = join(tasksDirectory, "combo-planted");
    expect(existsSync(join(directory, "answers", "fixes.patch"))).toBe(true);
    expect(existsSync(join(directory, "answers", "PLANTED.md"))).toBe(true);
    expect(filesUnder(join(directory, "repo")).filter((file) => /fixes\.patch|PLANTED/.test(file))).toEqual([]);
  });

  it("each ported task names its reference for the selfcheck", () => {
    ["sitegen", "brownfield", "combo-planted"].forEach((task) => {
      const { reference } = JSON.parse(readFileSync(join(tasksDirectory, task, "task.json"), "utf8")) as { reference?: string };
      expect(existsSync(join(tasksDirectory, task, reference ?? "missing")), task).toBe(true);
    });
  });
});
