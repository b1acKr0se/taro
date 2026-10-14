import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Prose naming Taro's Manager in a line of code (comments aside): "the manager", "its manager", "The ${project} manager". */
const LOWERCASE_MANAGER = /\b(?:[Tt]he|[Aa]|[Ii]ts|[Nn]o|project's)(?: \$\{\w+\})? manager\b/;

function codeLines(directory: string): { where: string; line: string }[] {
  return readdirSync(directory)
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
    .flatMap((name) =>
      readFileSync(join(directory, name), "utf8")
        .split("\n")
        .map((line, index) => ({ where: `${directory}/${name}:${index + 1}`, line }))
        .filter(({ line }) => !/^\s*(?:\/\/|\/\*|\*)/.test(line)),
    );
}

describe("the Manager's name in what the user reads (TR-031, TR-037)", () => {
  it("is capitalised in the client's text and labels, and in the daemon's and shared messages", () => {
    const root = join(__dirname, "..");
    const offending = ["client", "server", "shared"].flatMap((directory) => codeLines(join(root, directory))).filter(({ line }) => LOWERCASE_MANAGER.test(line));
    expect(offending.map(({ where, line }) => `${where.slice(root.length + 1)}: ${line.trim()}`)).toEqual([]);
  });
});
