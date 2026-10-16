/**
 * Full-screen views kept drawing their header under the phone's status bar as new UI arrived
 * (TR-042, TR-165): React Native's `SafeAreaView` pads only on iOS, and nothing caught it on the
 * web. So every client file reaches `Modal`, `SafeAreaView` and `StatusBar` only through
 * `client/safe-area.tsx`, and a file opening a `FullScreenModal` also clears the status bar with
 * `SafeArea`, `BottomSafeArea` (a sheet at the bottom) or `statusBarInset()`. The scan is textual,
 * and each rule is proven against a small bad sample below.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = "client/safe-area.tsx";
const GUARDED = ["Modal", "SafeAreaView", "StatusBar"];

/** What `file` breaks of the rule, one line each; empty when it keeps it. */
function safeAreaProblems(file: string, source: string): string[] {
  if (file === HELPER) return [];
  const problems: string[] = [];
  for (const match of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']react-native["']/g)) {
    const names = (match[1] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "" && !name.startsWith("type "))
      .map((name) => name.split(/\s+as\s+/)[0] ?? name);
    const guarded = names.filter((name) => GUARDED.includes(name));
    if (guarded.length > 0) problems.push(`${file} imports ${guarded.join(", ")} from react-native: use ${HELPER}`);
  }
  if (/import\s+\*\s+as\s+\w+\s+from\s*["']react-native["']/.test(source)) {
    problems.push(`${file} imports react-native as a namespace: import names, and Modal, SafeAreaView and StatusBar from ${HELPER}`);
  }
  if (/<FullScreenModal\b/.test(source) && !/<(?:Bottom)?SafeArea\b|\bstatusBarInset\(/.test(source)) {
    problems.push(`${file} opens a FullScreenModal without SafeArea, BottomSafeArea or statusBarInset()`);
  }
  return problems;
}

function clientFiles(): string[] {
  const client = readdirSync(join(PLUGIN_ROOT, "client"))
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => `client/${name}`);
  return ["index.client.tsx", ...client];
}

describe("safe-area rule", () => {
  it("holds for every client file", () => {
    const files = clientFiles();
    expect(files).toContain("client/old-plan-view.tsx");
    const problems = files.flatMap((file) => safeAreaProblems(file, readFileSync(join(PLUGIN_ROOT, file), "utf8")));
    expect(problems).toEqual([]);
  });

  it("flags the old-plan view as it was: React Native's Modal and SafeAreaView", () => {
    const before = 'import { Modal, Platform, SafeAreaView, ScrollView, Text, View } from "react-native";\n<Modal visible><SafeAreaView>{sheet}</SafeAreaView></Modal>';
    expect(safeAreaProblems("client/old-plan-view.tsx", before)).toEqual([
      "client/old-plan-view.tsx imports Modal, SafeAreaView from react-native: use client/safe-area.tsx",
    ]);
  });

  it("flags StatusBar, a renamed import and a multi-line import", () => {
    expect(safeAreaProblems("client/a.tsx", 'import { StatusBar } from "react-native";')).toHaveLength(1);
    expect(safeAreaProblems("client/a.tsx", 'import { Modal as NativeModal } from "react-native";')).toHaveLength(1);
    expect(safeAreaProblems("client/a.tsx", 'import {\n  Text,\n  SafeAreaView,\n} from "react-native";')).toHaveLength(1);
    expect(safeAreaProblems("client/a.tsx", 'import * as Native from "react-native";')).toHaveLength(1);
  });

  it("flags a FullScreenModal whose content does not clear the status bar", () => {
    const bare = 'import { FullScreenModal } from "./safe-area";\n<FullScreenModal visible><View>{sheet}</View></FullScreenModal>';
    expect(safeAreaProblems("client/a.tsx", bare)).toHaveLength(1);
    expect(safeAreaProblems("client/a.tsx", bare.replace("<View>{sheet}</View>", "<SafeArea>{sheet}</SafeArea>"))).toEqual([]);
    expect(safeAreaProblems("client/a.tsx", bare.replace("<View>", "<View style={{ paddingTop: statusBarInset() }}>"))).toEqual([]);
  });

  it("leaves the host's Modal, type-only names and the helper itself alone", () => {
    expect(safeAreaProblems("client/a.tsx", 'import { Icon, Modal } from "@getpaseo/plugin/client/react-native";')).toEqual([]);
    expect(safeAreaProblems("client/a.tsx", 'import { Text, type ModalProps } from "react-native";')).toEqual([]);
    expect(safeAreaProblems(HELPER, 'import { Modal, SafeAreaView, StatusBar } from "react-native";')).toEqual([]);
  });
});
