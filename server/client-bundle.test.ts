/**
 * The phone app evaluates the plugin's client bundle from source with Hermes: the bundle bypasses
 * Metro, so nothing lowers what Hermes evaluates differently from a browser. A class in the client
 * once failed the whole plugin at load on the phone ("Cannot read property 'prototype' of
 * undefined", TR-023) while the web app worked, and no other check could see it.
 *
 * This compiles `index.client.tsx` with the options of Paseo's plugin compiler
 * (`@getpaseo/server` `plugins/compiler.js`, `compileTarget` for the client, Paseo 0.11.2) and
 * fails on the constructs the Hermes rules in AGENTS.md forbid. The scan is textual: esbuild
 * exposes no syntax tree, and each pattern is proven against a small bad sample below.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build, type BuildOptions } from "esbuild";
import { describe, expect, it } from "vitest";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Paseo's `PLUGIN_SDK_SPECIFIERS` plus the host modules it keeps external for the client. */
const CLIENT_EXTERNALS = [
  "@getpaseo/plugin",
  "@getpaseo/plugin/server",
  "@getpaseo/plugin/server/provider",
  "@getpaseo/plugin/server/usage",
  "@getpaseo/plugin/server/acp",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@getpaseo/plugin/client/react-native",
  "@tanstack/react-query",
  "react",
  "react/jsx-runtime",
  "react-native",
  "zod",
];

const CLIENT_OPTIONS: BuildOptions = {
  bundle: true,
  format: "cjs",
  jsx: "automatic",
  platform: "neutral",
  target: "es2020",
  mainFields: ["module", "main"],
  supported: { "async-await": false },
  external: CLIENT_EXTERNALS,
  logLevel: "silent",
  treeShaking: true,
  write: false,
};

/** Paseo's `makeHermesInteropEager`: it rewrites esbuild's own loop closure before the app sees it. */
function makeHermesInteropEager(code: string): string {
  return code.replaceAll("get: () => from[key]", "value: from[key]");
}

async function compileClient(options: BuildOptions): Promise<string> {
  const result = await build({ ...CLIENT_OPTIONS, ...options });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error("the client compile produced no output");
  return makeHermesInteropEager(output);
}

function compileSample(source: string): Promise<string> {
  return compileClient({ stdin: { contents: source, loader: "ts", resolveDir: PLUGIN_ROOT } });
}

/**
 * The end of the statement, block or bracket starting at `start`, skipping string and template
 * contents; with `stopAtComma`, an expression also ends at a comma outside brackets.
 */
function statementEnd(code: string, start: number, stopAtComma = false): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < code.length; index += 1) {
    const character = code[index];
    if (quote !== null) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "{" || character === "(" || character === "[") depth += 1;
    else if (character === "}" || character === ")" || character === "]") {
      depth -= 1;
      if (depth === 0 && "{([".includes(code[start] ?? "")) return index + 1;
      if (depth < 0) return index;
    } else if (depth === 0 && (character === ";" || (character === "," && stopAtComma))) return index + 1;
  }
  return code.length;
}

/** The source of every closure in `code`: block or expression arrow bodies, and function bodies. */
function closureBodies(code: string): string[] {
  const bodies: string[] = [];
  for (const match of code.matchAll(/=>|\bfunction\b/g)) {
    let start = match.index + match[0].length;
    if (match[0] === "function") start = code.indexOf("{", start);
    else start += code.slice(start).search(/\S/);
    if (start < match.index) continue;
    bodies.push(code.slice(start, statementEnd(code, start, code[start] !== "{")));
  }
  return bodies;
}

/**
 * Hermes gives a closure created in a `let`/`const` loop the last iteration's binding, not its own.
 * Flags a loop whose body holds a closure that names the loop variable.
 */
function loopClosureCaptures(code: string): string[] {
  const found: string[] = [];
  const loop = /\bfor\s*\(\s*(?:let|const)\s+([A-Za-z_$][\w$]*)\b[^;)]*?\bof\b/g;
  for (const match of code.matchAll(loop)) {
    const variable = match[1] ?? "";
    const headerEnd = statementEnd(code, code.indexOf("(", match.index));
    const bodyStart = code.slice(headerEnd).search(/\S/) + headerEnd;
    const body = code.slice(bodyStart, statementEnd(code, bodyStart));
    const reference = new RegExp(`(?<![\\w$.])${variable.replaceAll("$", "\\$")}(?![\\w$])`);
    if (closureBodies(body).some((closure) => reference.test(closure))) {
      found.push(code.slice(match.index, bodyStart + Math.min(body.length, 160)));
    }
  }
  return found;
}

/** Every construct the Hermes rules forbid, as a short description of where it was found. */
function hermesProblems(code: string): string[] {
  const problems: string[] = [];
  for (const match of code.matchAll(/\bclass(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\b[^{]*)?\s*\{/g)) {
    problems.push(`class syntax: ${code.slice(match.index, match.index + 80)}`);
  }
  for (const match of code.matchAll(/\b(?:__publicField|__privateAdd|__privateGet|__privateSet)\(/g)) {
    problems.push(`lowered class member: ${code.slice(match.index, match.index + 80)}`);
  }
  for (const match of code.matchAll(/\basync\s*(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)|\bawait\s+[\w$(]/g)) {
    problems.push(`async syntax: ${code.slice(match.index, match.index + 80)}`);
  }
  for (const capture of loopClosureCaptures(code)) problems.push(`loop variable captured by a closure: ${capture}`);
  return problems;
}

describe("the client bundle Paseo compiles", () => {
  it("has nothing Hermes evaluates differently from a browser", async () => {
    const bundle = await compileClient({ entryPoints: [resolve(PLUGIN_ROOT, "index.client.tsx")] });
    expect(bundle.length).toBeGreaterThan(10_000);
    expect(hermesProblems(bundle)).toEqual([]);
  });
});

describe("the Hermes scan", () => {
  it("finds a class, with or without fields and getters", async () => {
    const problems = hermesProblems(
      await compileSample("export class Box { size = 0; get empty() { return this.size === 0; } }"),
    );
    expect(problems.some((problem) => problem.startsWith("class syntax"))).toBe(true);
    expect(problems.some((problem) => problem.startsWith("lowered class member"))).toBe(true);
  });

  it("finds a class expression", async () => {
    expect(hermesProblems(await compileSample("export const Box = class extends Array {};"))).not.toEqual([]);
  });

  it("finds a closure capturing a for…of variable", async () => {
    const problems = hermesProblems(
      await compileSample(
        "export function handlers(names: string[]) { const out: Array<() => string> = []; for (const name of names) { out.push(() => name); } return out; }",
      ),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("loop variable captured");
  });

  it("finds an unbraced loop body capturing its variable", async () => {
    const problems = hermesProblems(
      await compileSample(
        "export function handlers(names: string[], out: Array<() => string>) { for (const name of names) out.push(() => name); }",
      ),
    );
    expect(problems).toHaveLength(1);
  });

  it("finds async syntax had the compiler stopped lowering it", () => {
    expect(hermesProblems("const run = async () => { await load(); };")).toHaveLength(2);
    expect(hermesProblems("async function run() {}")).toHaveLength(1);
  });

  it("passes what Hermes handles: a factory, object-literal getters, lowered async, a loop variable used beside a closure", async () => {
    const bundle = await compileSample(`
      export function counter() { let count = 0; return { get value() { return count; }, add() { count += 1; } }; }
      export const load = async (url: string) => { const response = await fetch(url); return response.ok; };
      export function total(values: number[]) { let sum = 0; for (const value of values) sum += value; return sum; }
      export function first(tags: string[], lines: string[]) { for (const tag of tags) { const line = lines.find((entry) => entry !== ""); return line ?? tag; } return null; }
      export function sorted(groups: number[][]) { for (const group of groups) group.sort((left, right) => left - right); return groups; }
    `);
    expect(hermesProblems(bundle)).toEqual([]);
  });
});
