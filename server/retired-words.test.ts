/**
 * Taro keeps its tickets in its own tracker: no file in the repository names another tracker,
 * its branch or a conversion from it. The words are put together here so this file passes too.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The other tracker's name in any case or form (its tool, its branch, a status), and its conversion command. */
const RETIRED = new RegExp([["back", "log"].join(""), ["taro", "convert"].join(" ")].join("|"), "i");

/** The lines (1-based) of a text holding a retired word. */
export function linesWithRetiredWords(text: string): number[] {
  return text.split("\n").flatMap((line, index) => (RETIRED.test(line) ? [index + 1] : []));
}

describe("linesWithRetiredWords", () => {
  const word = ["Back", "log"].join("");

  it("finds the word in any case and form", () => {
    expect(linesWithRetiredWords(`a\n${word}.md`)).toEqual([2]);
    expect(linesWithRetiredWords(`taro/${word.toLowerCase()}`)).toEqual([1]);
    expect(linesWithRetiredWords(`status: "${word}"`)).toEqual([1]);
    expect(linesWithRetiredWords(word.toUpperCase())).toEqual([1]);
    expect(linesWithRetiredWords(`run ${["taro", "convert"].join(" ")} --dry-run`)).toEqual([1]);
  });

  it("passes other text", () => {
    expect(linesWithRetiredWords('status: "Queued"\ntaro/tickets\ntaro ticket check')).toEqual([]);
    expect(linesWithRetiredWords("")).toEqual([]);
  });
});

describe("repository files", () => {
  it("name no retired tracker, in their paths or their text", () => {
    const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: PLUGIN_ROOT, encoding: "utf8" })
      .split("\0")
      // A file deleted but not yet staged is still listed.
      .filter((file) => file !== "" && existsSync(join(PLUGIN_ROOT, file)));
    expect(files.length).toBeGreaterThan(0);
    const offending = files.flatMap((file) => {
      const pathHits = RETIRED.test(file) ? [`${file} (its path)`] : [];
      const content = readFileSync(join(PLUGIN_ROOT, file));
      if (content.includes(0)) return pathHits;
      return [...pathHits, ...linesWithRetiredWords(content.toString("utf8")).map((line) => `${file}:${line}`)];
    });
    expect(offending).toEqual([]);
  });
});
