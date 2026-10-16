/**
 * Text with no colour of its own is drawn in the platform's default, black: fine on a light card,
 * near invisible on a dark one. The board's Parked head shipped so (TR-166, fixed by TR-170), and
 * every screenshot was light, so nothing caught it. This parses every client file and fails on a
 * `Text`, `TextInput` or `CentredLabel` whose style sets no `color`, unless it sits inside a `Text`
 * (it inherits that one's colour, which is checked in turn).
 *
 * A style is followed through the file: inline objects, arrays (one coloured entry is enough),
 * both branches of a conditional, `styles.x` into the object `styles` was built from (a `useMemo`,
 * a local function's return), and into any object in the file with that key when `styles` came in
 * as a parameter. A style that is itself a parameter (`style` forwarded from a caller) is the
 * caller's to colour and is not followed into other files. Inline pieces built in another function
 * and placed inside a `Text` there say so with an `inherits colour` comment on the line above.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_TAGS = ["Text", "TextInput", "CentredLabel"];
const SCOPES = ["Program", "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"];
const MARKER = "inherits colour";

/** The few fields of Babel's nodes this reads; the rest stays untyped. */
interface Node {
  type: string;
  [field: string]: any;
}

type Colour = "set" | "unset" | "forwarded";

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).type === "string";
}

function walk(node: Node, visit: (node: Node, parents: Node[]) => void, parents: Node[] = []): void {
  visit(node, parents);
  const inner = [...parents, node];
  for (const [field, value] of Object.entries(node)) {
    if (field === "loc" || field.endsWith("Comments")) continue;
    if (Array.isArray(value)) value.filter(isNode).forEach((child) => walk(child, visit, inner));
    else if (isNode(value)) walk(value, visit, inner);
  }
}

function keyName(property: Node): string | undefined {
  if (property.type !== "ObjectProperty") return undefined;
  return property.key.type === "Identifier" ? property.key.name : property.key.type === "StringLiteral" ? property.key.value : undefined;
}

function tagName(element: Node): string {
  const name = element.openingElement.name;
  return name.type === "JSXIdentifier" ? name.name : "";
}

/** What `file` breaks of the rule, one line each; empty when it keeps it. */
function textColourProblems(file: string, source: string): string[] {
  const program = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] }).program as unknown as Node;
  const lines = source.split("\n");

  // Names declared in each function (and the module), with what they hold; a parameter holds nothing known.
  const PARAMETER: Node = { type: "Parameter" };
  const declared = new Map<Node, Map<string, Node | undefined>>();
  const namesIn = (scope: Node) => declared.get(scope) ?? declared.set(scope, new Map()).get(scope)!;
  const functions = new Map<string, Node>();
  walk(program, (node, parents) => {
    if (node.type === "FunctionDeclaration" && node.id) functions.set(node.id.name, node);
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
      const scope = [...parents].reverse().find((parent) => SCOPES.includes(parent.type)) ?? program;
      namesIn(scope).set(node.id.name, node.init);
    }
    if (SCOPES.includes(node.type) && Array.isArray(node.params)) {
      const names = namesIn(node);
      const add = (pattern: Node): void => {
        if (pattern.type === "Identifier") names.set(pattern.name, PARAMETER);
        else if (pattern.type === "AssignmentPattern") add(pattern.left);
        else if (pattern.type === "RestElement") add(pattern.argument);
        else if (pattern.type === "ObjectPattern") pattern.properties.forEach((property: Node) => add(property.type === "RestElement" ? property : property.value));
      };
      node.params.forEach(add);
    }
  });

  function lookup(name: string, parents: Node[]): { value: Node | undefined; parents: Node[] } | undefined {
    for (let index = parents.length - 1; index >= 0; index -= 1) {
      const names = declared.get(parents[index]!);
      if (names?.has(name)) return { value: names.get(name), parents: parents.slice(0, index + 1) };
    }
    return undefined;
  }

  /** Strips what only wraps a style: casts, `useMemo`, `StyleSheet.create`, calls to local functions. */
  function unwrap(expression: Node | undefined): Node | undefined {
    let current = expression;
    for (let step = 0; current !== undefined && step < 20; step += 1) {
      if (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression"].includes(current.type)) current = current.expression;
      else if (current.type === "CallExpression" && current.callee.type === "Identifier" && current.callee.name === "useMemo") current = current.arguments[0];
      else if (current.type === "CallExpression" && current.callee.type === "Identifier" && functions.has(current.callee.name)) current = functions.get(current.callee.name);
      else if (current.type === "CallExpression" && current.callee.type === "MemberExpression" && current.callee.property.name === "create") current = current.arguments[0];
      else if (current.type === "ArrowFunctionExpression" && current.body.type !== "BlockStatement") current = current.body;
      else if (current.type === "ArrowFunctionExpression" || current.type === "FunctionDeclaration") {
        current = [...current.body.body].reverse().find((statement: Node) => statement.type === "ReturnStatement")?.argument;
      } else return current;
    }
    return current;
  }

  function both(first: Colour, second: Colour): Colour {
    if (first === "unset" || second === "unset") return "unset";
    return first === "forwarded" || second === "forwarded" ? "forwarded" : "set";
  }

  function colour(expression: Node | undefined, parents: Node[], depth = 0): Colour {
    const style = unwrap(expression);
    if (style === undefined || depth > 10) return "unset";
    switch (style.type) {
      case "ObjectExpression":
        if (style.properties.some((property: Node) => keyName(property) === "color")) return "set";
        return style.properties.some((property: Node) => property.type === "SpreadElement" && colour(property.argument, parents, depth + 1) === "set") ? "set" : "unset";
      case "ArrayExpression": {
        const entries: Colour[] = style.elements.filter(isNode).map((entry: Node) => colour(entry, parents, depth + 1));
        return entries.includes("set") ? "set" : entries.includes("forwarded") ? "forwarded" : "unset";
      }
      case "ConditionalExpression":
        return both(colour(style.consequent, parents, depth + 1), colour(style.alternate, parents, depth + 1));
      case "LogicalExpression":
        // `a && style` has no style when `a` is false.
        return style.operator === "&&" ? "unset" : both(colour(style.left, parents, depth + 1), colour(style.right, parents, depth + 1));
      case "Identifier": {
        const found = lookup(style.name, parents);
        if (found === undefined) return "unset";
        return found.value === PARAMETER ? "forwarded" : colour(found.value, found.parents, depth + 1);
      }
      case "MemberExpression": {
        const key = style.property.type === "Identifier" ? style.property.name : style.property.value;
        if (style.object.type !== "Identifier") return "unset";
        const found = lookup(style.object.name, parents);
        if (found === undefined) return "unset";
        if (found.value === PARAMETER) return anyColouredKey(key);
        return keyColour(unwrap(found.value), key, found.parents, depth + 1);
      }
      default:
        return "unset";
    }
  }

  function keyColour(styles: Node | undefined, key: string, parents: Node[], depth: number): Colour {
    if (styles?.type === "ConditionalExpression") {
      return both(keyColour(unwrap(styles.consequent), key, parents, depth), keyColour(unwrap(styles.alternate), key, parents, depth));
    }
    if (styles?.type !== "ObjectExpression") return "unset";
    const property = styles.properties.find((candidate: Node) => keyName(candidate) === key);
    return property === undefined ? "unset" : colour(property.value, parents, depth + 1);
  }

  /** `styles.key` where `styles` came in as a parameter: some style object in the file colours `key`. */
  function anyColouredKey(key: string): Colour {
    let found = false;
    walk(program, (node, parents) => {
      if (!found && keyName(node) === key && node.value.type === "ObjectExpression" && colour(node.value, parents) === "set") found = true;
    });
    return found ? "set" : "unset";
  }

  const problems: string[] = [];
  walk(program, (node, parents) => {
    if (node.type !== "JSXElement" || !TEXT_TAGS.includes(tagName(node))) return;
    if (parents.some((parent) => parent.type === "JSXElement" && tagName(parent) === "Text")) return;
    const line: number = node.loc.start.line;
    if ((lines[line - 2] ?? "").includes(MARKER)) return;
    const attributes: Node[] = node.openingElement.attributes;
    const style = attributes.find((attribute) => attribute.type === "JSXAttribute" && attribute.name.name === "style");
    let result: Colour;
    if (style?.value?.type === "JSXExpressionContainer") result = colour(style.value.expression, parents);
    else result = style === undefined && attributes.some((attribute) => attribute.type === "JSXSpreadAttribute") ? "forwarded" : "unset";
    if (result === "unset") problems.push(`${file}:${line} <${tagName(node)}> sets no theme colour`);
  });
  return problems;
}

function clientFiles(): string[] {
  const client = readdirSync(join(PLUGIN_ROOT, "client"))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `client/${name}`);
  return ["index.client.tsx", ...client];
}

describe("text colour rule", () => {
  it("holds for every client file", () => {
    const files = clientFiles();
    expect(files).toContain("client/board.tsx");
    const problems = files.flatMap((file) => textColourProblems(file, readFileSync(join(PLUGIN_ROOT, file), "utf8")));
    expect(problems).toEqual([]);
  });

  it("flags the board's Parked head as it was (TR-166)", () => {
    const before = `function Board({ colors }) {
  const styles = useMemo(() => ({ columnTitle: { fontSize: 15, fontWeight: "700" as const }, count: { color: colors.foregroundMuted } }), [colors]);
  return (
    <Pressable>
      <Text style={styles.columnTitle}>Parked</Text>
      <Text style={styles.count}>3</Text>
      <Text style={[styles.columnTitle, { color: colors.foreground }]}>Queued</Text>
    </Pressable>
  );
}`;
    expect(textColourProblems("client/board.tsx", before)).toEqual(["client/board.tsx:5 <Text> sets no theme colour"]);
  });

  it("flags a Text with no style, a conditional with an uncoloured branch, and `a && style`", () => {
    const sample = `const styles = StyleSheet.create({ plain: { fontSize: 12 }, tinted: { color: "c" } });
function View({ on }) {
  return (
    <View>
      <Text>bare</Text>
      <Text style={on ? styles.tinted : styles.plain}>half</Text>
      <Text style={on && styles.tinted}>maybe</Text>
      <TextInput style={{ fontSize: 12 }} />
      <CentredLabel style={styles.plain}>label</CentredLabel>
    </View>
  );
}`;
    expect(textColourProblems("client/sample.tsx", sample)).toEqual([
      "client/sample.tsx:5 <Text> sets no theme colour",
      "client/sample.tsx:6 <Text> sets no theme colour",
      "client/sample.tsx:7 <Text> sets no theme colour",
      "client/sample.tsx:8 <TextInput> sets no theme colour",
      "client/sample.tsx:9 <CentredLabel> sets no theme colour",
    ]);
  });

  it("accepts nested text, styles from a local function or a styles parameter, forwarded styles and the marker", () => {
    const sample = `function cardStyles(colors) {
  return { body: { color: colors.foreground }, bold: { fontWeight: "700" } };
}
function Card({ colors, style }) {
  const styles = cardStyles(colors);
  return (
    <View>
      <Text style={styles.body}>
        plain <Text style={styles.bold}>bold</Text>
      </Text>
      <Text style={[style, { width: 4 }]}>forwarded</Text>
      <Row styles={styles} />
    </View>
  );
}
function Row({ styles }) {
  return <Text style={[styles.body, null]}>row</Text>;
}
function inline(styles) {
  // inherits colour: placed inside the paragraph's Text
  return <Text style={styles.bold}>bold</Text>;
}`;
    expect(textColourProblems("client/sample.tsx", sample)).toEqual([]);
  });
});
