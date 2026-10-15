import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The role written as a name in running text: "the Manager", "a fresh Manager", "The ${project} Manager",
 * or a label opening on it ("Manager asks"). Only a title naming one project's manager keeps the capital
 * ("notes-app · Manager", the Manager tab), and neither reads like this (TR-104).
 */
const CAPITAL_MANAGER = /(?:\b[a-z][a-z']*|\})(?: \$\{\w+\})? \**Manager\b(?! tab)|["'`]Manager [a-z]/;

function lines(directory: string, keep: (name: string) => boolean): { where: string; line: string }[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter(keep)
    .flatMap((name) =>
      readFileSync(join(directory, name), "utf8")
        .split("\n")
        .map((line, index) => ({ where: `${directory}/${name}:${index + 1}`, line })),
    );
}

describe("the manager's name in what the user and agents read (TR-031, TR-037, TR-104)", () => {
  it("is lowercase in the client's, daemon's and shared text, the templates, the skill and the README", () => {
    const root = join(__dirname, "..");
    const code = ["client", "server", "shared"].flatMap((directory) =>
      lines(join(root, directory), (name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts") && !name.includes("test-data")),
    );
    const prose = ["templates", "skill"].flatMap((directory) => lines(join(root, directory), (name) => name.endsWith(".md")));
    const readme = readFileSync(join(root, "README.md"), "utf8").split("\n").map((line, index) => ({ where: `${root}/README.md:${index + 1}`, line }));
    const offending = [...code, ...prose, ...readme].filter(({ line }) => CAPITAL_MANAGER.test(line));
    expect(offending.map(({ where, line }) => `${where.slice(root.length + 1)}: ${line.trim()}`)).toEqual([]);
  });

  it("flags the capital in running text and labels, but not in a session title or the tab", () => {
    expect(CAPITAL_MANAGER.test("Tell the Manager what you need…")).toBe(true);
    expect(CAPITAL_MANAGER.test("`The ${project} Manager is in the middle of a turn.`")).toBe(true);
    expect(CAPITAL_MANAGER.test('"Manager asks"')).toBe(true);
    expect(CAPITAL_MANAGER.test("restart it from Manager settings")).toBe(true);
    expect(CAPITAL_MANAGER.test("You tell a **Manager** agent what you want")).toBe(true);
    expect(CAPITAL_MANAGER.test("Tell the manager what you need…")).toBe(false);
    expect(CAPITAL_MANAGER.test("then open its Manager tab")).toBe(false);
    expect(CAPITAL_MANAGER.test("return `${project} · Manager`;")).toBe(false);
    expect(CAPITAL_MANAGER.test('{ value: "manager", label: "Manager" },')).toBe(false);
  });
});
