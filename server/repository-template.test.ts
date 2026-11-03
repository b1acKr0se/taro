// TR-250: a repository's own PR template replaces the default one.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { hasRepositoryTemplate } from "./repository-template";

const made: string[] = [];
async function repository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "notes-app-"));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}
afterEach(async () => {
  await Promise.all(made.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("hasRepositoryTemplate", () => {
  it("finds a template file or a template folder", async () => {
    expect(await hasRepositoryTemplate(await repository({ ".github/pull_request_template.md": "x" }))).toBe(true);
    expect(await hasRepositoryTemplate(await repository({ "docs/pull_request_template.md": "x" }))).toBe(true);
    expect(await hasRepositoryTemplate(await repository({ ".github/PULL_REQUEST_TEMPLATE/bug.md": "x" }))).toBe(true);
  });

  it("is false without one, or for a missing repository", async () => {
    expect(await hasRepositoryTemplate(await repository({ "README.md": "x" }))).toBe(false);
    expect(await hasRepositoryTemplate(join(tmpdir(), "notes-app-missing-folder"))).toBe(false);
  });
});
