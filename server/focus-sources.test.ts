/**
 * Every Taro text field and button goes through `client/focus.tsx` (TR-078), so none shows Paseo's green
 * focus ring: a file importing the raw `TextInput` or `Pressable`, a surface registered without the
 * theme's ring colour, or pressable text without it, fails here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientFiles = readdirSync(join(root, "client"))
  .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
  .map((name) => ({ name: `client/${name}`, source: readFileSync(join(root, "client", name), "utf8") }));
const entry = { name: "index.client.tsx", source: readFileSync(join(root, "index.client.tsx"), "utf8") };

/** The names a file imports as values (not `type`) from `module`. */
function valueImports(source: string, module: string): string[] {
  const pattern = new RegExp(`^import \\{([^}]*)\\} from "${module.replace(/[/.]/g, "\\$&")}";`, "gm");
  return [...source.matchAll(pattern)].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "" && !name.startsWith("type ")),
  );
}

describe("focus sources", () => {
  it("finds the client's files", () => {
    expect(clientFiles.length).toBeGreaterThan(20);
    expect(valueImports('import { Pressable, Text, type View } from "react-native";', "react-native")).toEqual(["Pressable", "Text"]);
  });

  it("draws every text field with Taro's TextInput", () => {
    const raw = [...clientFiles, entry].filter(
      (file) => file.name !== "client/focus.tsx" && valueImports(file.source, "@getpaseo/plugin/client/react-native").includes("TextInput"),
    );
    expect(raw.map((file) => file.name)).toEqual([]);
    // React Native's own TextInput would get the ring too (`keyboard.tsx` reads its focus state, drawing none).
    const native = [...clientFiles, entry].filter((file) => valueImports(file.source, "react-native").includes("TextInput") && /<TextInput\b/.test(file.source));
    expect(native.map((file) => file.name)).toEqual([]);
    const users = clientFiles.filter((file) => valueImports(file.source, "./focus").includes("TextInput")).map((file) => file.name);
    expect(users).toEqual(expect.arrayContaining(["client/reply-box.tsx", "client/settings-form.tsx"]));
  });

  it("draws every button with Taro's Pressable", () => {
    const raw = [...clientFiles, entry].filter((file) => file.name !== "client/focus.tsx" && /\b(Pressable|TouchableOpacity|TouchableHighlight)\b/.test(valueImports(file.source, "react-native").join(",")));
    expect(raw.map((file) => file.name)).toEqual([]);
  });

  it("gives pressable text the ring", () => {
    const pressableText = clientFiles.filter((file) => /<Text\b[^>]*\bonPress=/.test(file.source));
    expect(pressableText.map((file) => file.name)).toEqual(["client/markdown.tsx"]);
    for (const file of pressableText) expect(file.source).toMatch(/focusRingStyle\(/);
  });

  it("gives every surface registered with Paseo the theme's ring colour", () => {
    // Each may sit inside the crash trail's boundary (TR-132), which draws nothing of its own.
    const components = [...entry.source.matchAll(/Component: (?:withCrashTrail\("[^"]+", )?([^,}\n]+)/g)].map((match) => (match[1] ?? "").trim());
    expect(components.length).toBe(5);
    expect(components.filter((component) => !component.startsWith("withFocusRing("))).toEqual([]);
    // Every surface's failures reach the crash trail.
    expect([...entry.source.matchAll(/Component: withCrashTrail\(/g)]).toHaveLength(5);
  });
});
