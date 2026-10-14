import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("agent-facing text", () => {
  it("no longer names the Backlog.md tool: `taro ticket` replaced it", () => {
    const forbidden = /backlog task|backlog search|backlog init|BACKLOG_CWD|Backlog CLI|Backlog\.md/;
    const found = ["skill", "templates"]
      .flatMap((directory) => filesUnder(join(ROOT, directory)))
      .filter((path) => forbidden.test(readFileSync(path, "utf8")));
    expect(found).toEqual([]);
  });
});
