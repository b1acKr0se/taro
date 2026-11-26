/** The skill pages for a brand new project say what the plugin's start and the owners rely on. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL = import.meta.dirname;
const TEMPLATES = join(SKILL, "..", "templates", "messages");

function skill(page: string): string {
  return readFileSync(join(SKILL, page), "utf8");
}
function message(name: string): string {
  return readFileSync(join(TEMPLATES, name), "utf8");
}

describe("the new-project pages", () => {
  it("spec template has every section", () => {
    const spec = skill("templates/spec.md");
    for (const heading of ["## Product", "## Users and flows", "## Design", "## Technical choices", "## Out of scope"]) {
      expect(spec).toContain(heading);
    }
    const task = /## Task <?\w+>? — [^\n]*\n([\s\S]*)$/.exec(spec)?.[1] ?? "";
    for (const field of ["Goal:", "Done when:", "Touches:", "Depends on:"]) expect(task).toContain(field);
  });

  it("shape page rules", () => {
    const page = skill("levels/shape.md");
    expect(page).toMatch(/user's answers/);
    expect(page).toMatch(/real gap/);
    expect(page).toContain("SPEC.md");
    expect(page).toMatch(/independent reviewer/);
    expect(page).toMatch(/Up to four questions share a card/);
    expect(page).toMatch(/Accept is the plan\s+approval/);
    expect(page).toMatch(/never create child tickets/);
    expect(page).toMatch(/no `complexity-` label/);
  });

  it("task page conflict rule", () => {
    const page = skill("levels/spec-task.md");
    expect(page).toMatch(/Only three cases/);
    expect(page).toMatch(/contradicts itself/);
    expect(page).toMatch(/cannot be met as written/);
    expect(page).toMatch(/does not cover/);
    expect(page).toContain("surprise:");
    expect(page).toContain("SPEC-AMENDED");
    expect(page).toMatch(/against the section's Done when/);
    expect(page).toMatch(/does not\s+lint it/);
  });

  it("new-project prompt and page", () => {
    const prompt = message("new-project.md");
    expect(prompt).toContain("{{project}}");
    expect(prompt).toContain("{{skill}}/reference/new-project.md");
    const page = skill("reference/new-project.md");
    expect(page).toContain("What are you building, and who is it for?");
    for (const area of ["what it is and who it is for", "main flows", "look and feel", "platform and technical constraints", "out of scope"]) {
      expect(page).toContain(area);
    }
    expect(page).toMatch(/two to four related questions/);
    expect(page).toContain("`shape`");
    expect(page).toContain("templates/shape-ticket.md");
  });

  it("manager handles shape and feedback", () => {
    const page = skill("roles/manager.md");
    for (const text of ["`shape`", "`spec-task`", "by spec", "SPEC-AMENDED", "not on the base branch", "waits for the user's Accept"]) {
      expect(page).toContain(text);
    }
  });

  it("owner and tickets name the new pages", () => {
    const owner = skill("roles/owner.md");
    expect(owner).toContain("levels/shape.md");
    expect(owner).toContain("levels/spec-task.md");
    const tickets = skill("reference/tickets.md");
    for (const text of ["`shape`", "`spec-task`", "SPEC-AMENDED", "by spec", "the user's exact words"]) expect(tickets).toContain(text);
  });

  it("done message covers shape", () => {
    const done = message("after-done.md");
    expect(done).toContain("`shape`");
    expect(done).toContain("roles/manager.md");
  });

  it("step templates name no rating", () => {
    for (const name of ["step-shape.md", "step-spec-task.md"]) {
      expect(existsSync(join(TEMPLATES, name))).toBe(true);
      const text = message(name);
      expect(text).toContain("{{ticket}}");
      expect(text).not.toContain("{{level}}");
      expect(text).not.toMatch(/rated/);
    }
  });
});
