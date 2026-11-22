import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const ENTRIES = ["shared/tracker-cards.ts", "server/tracker-cards.ts"];

function importsOf(file: string): string[] {
  const source = readFileSync(join(ROOT, file), "utf8");
  return [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((match) => match[1] as string);
}

/** Every file the entries reach through relative imports, with what each imports. */
function reachable(): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [...ENTRIES];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    const imports = importsOf(file);
    seen.set(file, imports);
    for (const specifier of imports) {
      if (specifier.startsWith(".")) queue.push(relative(ROOT, resolve(ROOT, dirname(file), specifier)));
    }
  }
  return seen;
}

describe("tracker cards stay host-neutral", () => {
  it("no Paseo imports", () => {
    const files = reachable();
    expect([...files.keys()]).toEqual(expect.arrayContaining(ENTRIES));
    for (const [file, imports] of files) {
      for (const specifier of imports) {
        // Node builtins, or another file of ours by its `.ts` name (plain Node type stripping needs the extension).
        const allowed = specifier.startsWith("node:") || (specifier.startsWith(".") && specifier.endsWith(".ts") && !specifier.includes("host-types"));
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
      }
    }
  });
});
