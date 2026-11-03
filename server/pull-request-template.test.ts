// TR-250: the default pull-request body's headings live in shared/, and the template file must agree.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PULL_REQUEST_TEMPLATE_HEADINGS } from "../shared/pull-request-template";

describe("skill/templates/pull-request.md", () => {
  it("has exactly the shared headings, in order", () => {
    const file = readFileSync(join(__dirname, "..", "skill", "templates", "pull-request.md"), "utf8");
    const headings = [...file.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([...PULL_REQUEST_TEMPLATE_HEADINGS]);
  });
});
