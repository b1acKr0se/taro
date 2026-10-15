import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localMergeInstruction } from "../shared/execution";

// Accept's local message points at the owner's role file for the path (TR-109): both must keep saying the same.
const skill = join(__dirname, "..", "skill");
const owner = readFileSync(join(skill, "roles", "owner.md"), "utf8");
const tickets = readFileSync(join(skill, "reference", "tickets.md"), "utf8");

describe("the local-branch accept path (TR-109)", () => {
  it("is where Accept's message sends the owner", () => {
    expect(localMergeInstruction(`EXECUTION x — review-head: ${"c".repeat(40)}`, "main", "/home/user/notes-app")).toContain("as roles/owner.md says (Accept, local branch)");
    expect(owner).toMatch(/- \*\*Accept:\*\*[\s\S]*- \*\*Local branch\*\*/);
  });

  it("covers a moved head, a dirty or switched main checkout, a moved base and the fast-forward, in that order", () => {
    const path = owner.slice(owner.indexOf("**Local branch**"));
    const steps = ["is not the recorded review head", "uncommitted or untracked changes, or is not on", "The base branch moved", "merge --ff-only"].map((step) => path.indexOf(step));
    expect(steps.every((at) => at > 0)).toBe(true);
    expect([...steps].sort((left, right) => left - right)).toEqual(steps);
  });

  it("presents again on any conflict, and records NOT-MERGED only for the main checkout", () => {
    expect(owner).toContain("Any conflict, even\n       one you resolved, or failing checks → the user has not seen it: present it again.");
    expect(owner).toContain("record **NOT-MERGED** with\n       the reason");
    expect(tickets).toMatch(/- \*\*NOT-MERGED\*\*: [\s\S]*`NOT-MERGED \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z — /);
  });
});
