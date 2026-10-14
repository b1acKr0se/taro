/**
 * The phone app evaluates the plugin's client bundle from source with Hermes: the bundle bypasses
 * Metro, so nothing lowers what Hermes evaluates differently from a browser. A class in the client
 * once failed the whole plugin at load on the phone ("Cannot read property 'prototype' of
 * undefined", TR-023) while the web app worked, and no other check could see it.
 *
 * This compiles `index.client.tsx` with the options of Paseo's plugin compiler
 * (`@getpaseo/server` `plugins/compiler.js`, `compileTarget` for the client, Paseo 0.11.2) and
 * fails on the constructs the Hermes rules in AGENTS.md forbid. The scan is textual: esbuild
 * exposes no syntax tree, and each pattern is proven against a small bad sample below. The scan
 * only knows the failures already seen, so the bundle is also loaded in a real Hermes VM (below).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

/** Paseo's `wrapCommonJsBundle`: the app evaluates this string and calls it with its `require`. */
function wrapCommonJsBundle(code: string): string {
  return `(function(require) {\nconst module = { exports: {} };\nconst exports = module.exports;\n${code}\nreturn module.exports;\n})`;
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

/**
 * The phone's load, run in a real Hermes VM: the app's `runPluginClientBundle` evals the bundle,
 * calls it with the host modules, then calls the default export with the client context. Paseo
 * drops a plugin whose load throws, and the phone shows only "This plugin surface is unavailable."
 * (TR-034), so a load that fails here must fail the tests. React is the real one (it has no
 * classes); the other host modules are stubs that answer any property, so this proves the bundle's
 * own code under Hermes, not the host's exports. hermes-engine-cli is Hermes 0.12, older than the
 * app's: it rejects class syntax just as the phone did in TR-023.
 */
const HERMES_BIN = resolve(
  PLUGIN_ROOT,
  "node_modules/hermes-engine-cli",
  process.platform === "darwin" ? "osx-bin/hermes" : process.platform === "win32" ? "win64-bin/hermes.exe" : "linux64-bin/hermes",
);

const HERMES_LOADER = `
function stub(name, isModule) {
  var call = function () { return stub(name + "()", false); };
  return new Proxy(call, { get: function (target, key) {
    if (typeof key !== "string" || key === "then" || key === "__esModule") return undefined;
    if (key === "default" && isModule) return undefined;
    if (key === "create") return function (value) { return value; };
    if (key === "OS") return "android";
    if (key === "select") return function (options) { return "android" in options ? options.android : "native" in options ? options.native : options["default"]; };
    return stub(name + "." + key, false);
  } });
}
var hostModules = { "react": globalThis.hostReact, "react/jsx-runtime": globalThis.hostJsxRuntime };
["zod", "@tanstack/react-query", "@getpaseo/plugin", "@getpaseo/plugin/client", "@getpaseo/plugin/client/ui",
 "@getpaseo/plugin/client/react-native", "react-native"].forEach(function (name) { hostModules[name] = stub(name, true); });
var registered = [];
var client = new Proxy({}, { get: function (target, method) {
  return function (contribution) {
    registered.push(String(method) + ":" + (contribution.id || contribution.kind || contribution.name));
    return function () {};
  };
} });
var result;
try {
  var bundle = (0, globalThis.eval)(pluginBundle);
  if (typeof bundle !== "function") throw new Error("the client bundle is not executable");
  var exported = bundle(function (name) {
    if (name in hostModules) return hostModules[name];
    throw new Error("Module " + name + " is not available in plugin client code");
  });
  var contribute = exported !== null && typeof exported === "object" ? exported["default"] : undefined;
  if (typeof contribute !== "function") throw new Error("the plugin must default export a function");
  if (typeof contribute(client) !== "function") throw new Error("the contribution must return a cleanup function");
  result = { loaded: true, registered: registered };
} catch (error) {
  result = { loaded: false, error: String(error && error.stack || error) };
}
print("HERMES_RESULT " + JSON.stringify(result));
`;

async function hostReactSource(): Promise<string> {
  const result = await build({
    stdin: {
      contents: 'import * as React from "react"; import * as JsxRuntime from "react/jsx-runtime"; globalThis.hostReact = React; globalThis.hostJsxRuntime = JsxRuntime;',
      loader: "ts",
      resolveDir: PLUGIN_ROOT,
    },
    bundle: true,
    format: "iife",
    platform: "neutral",
    target: "es2020",
    mainFields: ["module", "main"],
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
    write: false,
  });
  const output = result.outputFiles?.[0]?.text;
  if (!output) throw new Error("the React host build produced no output");
  // esbuild's namespace copy closes over its loop variable, which this Hermes reads as the last key
  // (every export became React.version). The app's React comes from Metro, not esbuild; this
  // stand-in gets the same eager rewrite so plugin code calling React at load (createContext) works.
  return makeHermesInteropEager(output);
}

type HermesLoad = { loaded: true; registered: string[] } | { loaded: false; error: string };

/** Loads a compiled (unwrapped) client bundle in Hermes as the phone app does. */
async function loadInHermes(bundle: string): Promise<HermesLoad> {
  const directory = mkdtempSync(join(tmpdir(), "taro-hermes-"));
  try {
    const script = join(directory, "load.js");
    const pluginBundle = `var pluginBundle = ${JSON.stringify(wrapCommonJsBundle(bundle))};`;
    writeFileSync(script, [await hostReactSource(), pluginBundle, HERMES_LOADER].join("\n"));
    const run = spawnSync(HERMES_BIN, ["-Xes6-proxy", "-w", script], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (run.error) throw run.error;
    const line = run.stdout.split("\n").find((entry) => entry.startsWith("HERMES_RESULT "));
    if (line === undefined) return { loaded: false, error: `Hermes exited ${String(run.status)}: ${run.stderr.slice(0, 2000)}` };
    return JSON.parse(line.slice("HERMES_RESULT ".length)) as HermesLoad;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("the client bundle loaded by Hermes as the phone does", () => {
  it("loads and registers the Taro screen and every other contribution", async () => {
    const load = await loadInHermes(await compileClient({ entryPoints: [resolve(PLUGIN_ROOT, "index.client.tsx")] }));
    expect(load).toEqual({
      loaded: true,
      registered: [
        "addScreen:taro",
        "addSidebarHeaderItem:taro",
        "addWorkspacePanel:taro-ticket",
        "addCommandCenterItem:open-taro",
        "addSlashCommand:taro",
        "addTimelineTransformer:taro-decisions",
        "addTimelineRenderer:taro-decision-text",
        "addTimelineRenderer:taro-decision-block",
      ],
    });
  }, 60_000);

  const sampleEntry = 'export default function contribute(client: any) { client.addScreen({ id: "sample" }); return () => {}; }';

  it("passes a plain sample, so a failure below is the sample's own", async () => {
    expect(await loadInHermes(await compileSample(sampleEntry))).toEqual({ loaded: true, registered: ["addScreen:sample"] });
  }, 60_000);

  it("fails a bundle that throws while its modules load", async () => {
    const load = await loadInHermes(await compileSample(`const ready = (globalThis as any).missing.value;\n${sampleEntry}\nexport { ready };`));
    expect(load.loaded).toBe(false);
  }, 60_000);

  it("fails a bundle Hermes cannot parse, such as a class (TR-023)", async () => {
    const load = await loadInHermes(await compileSample(`export class Box {}\n${sampleEntry}`));
    expect(load.loaded).toBe(false);
  }, 60_000);

  it("fails a contribution that throws", async () => {
    const load = await loadInHermes(await compileSample('export default function contribute() { throw new Error("broken"); }'));
    expect(load).toMatchObject({ loaded: false, error: expect.stringContaining("broken") });
  }, 60_000);
});
