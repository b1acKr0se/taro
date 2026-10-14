/**
 * Keeps the user's other projects, company, machine and private email out of
 * this repository, which is published.
 *
 * The names themselves would defeat the purpose, so only their SHA-256 hashes
 * are kept here, each taken of the name in lowercase with `.`, `-` and `_`
 * removed, beside its length. A short name's hash can be brute-forced: this
 * keeps the names out of the repository's text, not secret.
 *
 * Every tracked file's path and text is lowercased with the same separators
 * and all spaces and tabs removed, and every window of each length inside a run
 * of letters and digits is hashed, so a name is found in any case, with any of
 * those separators, written as two words or inside a longer word. Joining words
 * can match across two unrelated ones; such a line is reworded. A failure names
 * the file and line, never the name.
 *
 * To add a name: `printf %s <name in lowercase, no . - _> | sha256sum`.
 */
import { execFileSync } from "node:child_process";
import { hash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type HashedName = { length: number; sha256: string };

const PRIVATE_NAMES: HashedName[] = [
  { length: 7, sha256: "b4a0c3d99fbeaebda16571a3e7a237b839fffce28470076d05fdf1bbf2263851" },
  { length: 9, sha256: "2e4562dc1490688e85a190ef72fc9a1012dc1ca22778995020b920f8dd1a3942" },
  { length: 8, sha256: "9e33ad14b6a1bffbc66dc2fd91808d3702513ccb7e31914536a75fe252f1c47a" },
  { length: 8, sha256: "e895d16f03e4ed084de67a6f2ced98aab6dfd2a04b5d035135765d99d5e8f77f" },
  { length: 9, sha256: "e184b93b9f77684dfa537f7106e417fd0f8620cfa49f414be55368be63843bf2" },
  { length: 9, sha256: "e4c466c50258b76dd6bec3ef96783eedee74efa3c4f38ccc0bc81db11f8262ed" },
  { length: 5, sha256: "3e9e0d2de824823352863e35dded3fc7a408a3eab902721325bca4750f61b38e" },
];

function sha256(text: string): string {
  return hash("sha256", text);
}

/**
 * Finds the lines (1-based) of a text holding one of `names`. Each window is
 * hashed once per finder: the repository repeats most of them across files.
 */
function nameFinder(names: HashedName[]): (text: string) => number[] {
  const hashesByLength = new Map<number, Set<string>>();
  names.forEach(({ length, sha256: nameHash }) => {
    hashesByLength.set(length, (hashesByLength.get(length) ?? new Set()).add(nameHash));
  });
  const isName = new Map<string, boolean>();
  const windowIsName = (window: string, hashes: Set<string>): boolean => {
    let known = isName.get(window);
    if (known === undefined) {
      known = hashes.has(sha256(window));
      isName.set(window, known);
    }
    return known;
  };
  return (text) => {
    const found: number[] = [];
    text.split("\n").forEach((line, index) => {
      const runs = line.toLowerCase().replace(/[._\-\s]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
      const hit = runs.some((run) =>
        [...hashesByLength].some(([length, hashes]) => {
          for (let start = 0; start + length <= run.length; start += 1) {
            if (windowIsName(run.slice(start, start + length), hashes)) return true;
          }
          return false;
        }),
      );
      if (hit) found.push(index + 1);
    });
    return found;
  };
}

describe("nameFinder", () => {
  const linesWithNames = nameFinder([{ length: 9, sha256: sha256("acmewidgt") }]);

  it("finds a name in any case, with separators and inside a longer word", () => {
    expect(linesWithNames("Acme.Widgt")).toEqual([1]);
    expect(linesWithNames("x\nacme-widgt\ny")).toEqual([2]);
    expect(linesWithNames("ACME_WIDGT")).toEqual([1]);
    expect(linesWithNames("path/to/myacmewidgtapp.ts")).toEqual([1]);
    expect(linesWithNames("Acme Widgt")).toEqual([1]);
    expect(linesWithNames("acme \t widgt")).toEqual([1]);
    expect(linesWithNames("a\nb\nfrom acmewidgt")).toEqual([3]);
  });

  it("ignores near misses and words split by other punctuation or a line break", () => {
    expect(linesWithNames("acme, widgt")).toEqual([]);
    expect(linesWithNames("acme\nwidgt")).toEqual([]);
    expect(linesWithNames("acmewidget acmewidg")).toEqual([]);
    expect(linesWithNames("")).toEqual([]);
  });

  it("keeps one entry per name", () => {
    expect(new Set(PRIVATE_NAMES.map((name) => name.sha256)).size).toBe(PRIVATE_NAMES.length);
  });
});

describe("tracked files", () => {
  it("hold none of the private names, in their paths or their text", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: PLUGIN_ROOT, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    const linesWithNames = nameFinder(PRIVATE_NAMES);
    const offending = files.flatMap((file) => {
      const pathHits = linesWithNames(file).length > 0 ? [`${file} (its path)`] : [];
      const content = readFileSync(join(PLUGIN_ROOT, file));
      if (content.includes(0)) return pathHits;
      return [
        ...pathHits,
        ...linesWithNames(content.toString("utf8")).map((line) => `${file}:${line}`),
      ];
    });
    expect(offending).toEqual([]);
  });
});
