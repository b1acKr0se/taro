import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { localMergeInstruction, pullRequestMergeInstruction } from "../shared/execution";

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

  it("keeps a clean rebase out of the records that read as presenting again", () => {
    expect(owner).toContain("never as a new review-head or EVIDENCE (both read as presenting again)");
  });

  it("presents again on any conflict, and records NOT-MERGED only for the main checkout", () => {
    expect(owner).toContain("Any conflict, even\n       one you resolved, or failing checks → the user has not seen it: present it again.");
    expect(owner).toContain("record **NOT-MERGED** with\n       the reason");
    expect(tickets).toMatch(/- \*\*NOT-MERGED\*\*: [\s\S]*`NOT-MERGED \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z — /);
  });
});

describe("the pull-request accept path (TR-110)", () => {
  const head = "d".repeat(40);
  const instruction = pullRequestMergeInstruction(`EXECUTION x — pr: https://github.com/o/r/pull/3, review-head: ${head}`, null, { method: "squash", baseBranch: "main", repoPath: "/home/user/notes-app" });
  const path = owner.slice(owner.indexOf("**Pull request** (TR-110)"), owner.indexOf("**Local branch**"));

  it("is where Accept's message sends the owner", () => {
    expect(instruction).toContain("as roles/owner.md says (Accept, pull request)");
    expect(owner).toMatch(/- \*\*Accept:\*\*[\s\S]*- \*\*Pull request\*\* \(TR-110\)/);
  });

  it("covers an earlier merge, the method, the clean check, the fast-forward and ACCEPTANCE, in that order", () => {
    const steps = ["already `MERGED`", "--merge|--rebase|--squash", "status --porcelain", "merge --ff-only origin/<base>", "Record ACCEPTANCE"].map((step) => path.indexOf(step));
    expect(steps.every((at) => at > 0)).toBe(true);
    expect([...steps].sort((left, right) => left - right)).toEqual(steps);
  });

  it("never falls back to another method, and records NOT-MERGED or NOT-SYNCED for the user", () => {
    expect(path).toContain("GitHub refusing the method → never try another: record\n       **NOT-MERGED**");
    expect(path).toContain("record **NOT-SYNCED** with the reason");
    expect(tickets).toMatch(/- \*\*NOT-SYNCED\*\*: [\s\S]*`NOT-SYNCED \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z — /);
  });
});

describe("where the acceptance card goes (TR-131)", () => {
  const template = readFileSync(join(__dirname, "..", "templates", "messages", "request-changes.md"), "utf8");

  it("is under the delivering turn, so that turn ends with done: and later replies with waiting:", () => {
    expect(owner).toMatch(/end the delivering turn with `done: …`\s+and any later reply while you await acceptance with `waiting: acceptance of <ID>`/);
    expect(owner).toMatch(/the turn that delivers again ends with `done: …`/);
    expect(template).toContain("End the turn that delivers again with `done: …`");
  });

  it("tells the owner to move the ticket itself when the plugin's write failed", () => {
    expect(owner).toMatch(/if\s+the ticket still reads Awaiting acceptance, the plugin's write failed: move it yourself/);
  });
});
