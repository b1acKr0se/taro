/**
 * Typing long text into a reply box on the phone (TR-125). A controlled field there got its text
 * written back by JavaScript on every keystroke; with long text in a busy pane JavaScript fell behind
 * the keyboard, those writes raced the native text, and the Paseo app crashed. This renders the real
 * `client/reply-box.tsx` as the phone app does (Platform.OS "ios", React Native's host components
 * standing in as plain host elements) and counts the text writes that reach the native field.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { createElement, useState, type ReactElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it } from "vitest";

// Tells React that `act` drives these renders.
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);

/** A module whose capitalised exports are host components named after them, and whose others answer anything. */
function hostModule(name: string, own: Record<string, unknown>): unknown {
  return new Proxy(own, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (key === "__esModule") return true;
      return /^[A-Z]/.test(key) ? `${name}.${key}` : () => undefined;
    },
  });
}

/** The platform the app runs on; a test may switch it to the web. */
const platform = { OS: "ios" };
const reactNative = hostModule("rn", {
  Platform: {
    get OS() {
      return platform.OS;
    },
    select: (choices: { ios?: unknown; native?: unknown; default?: unknown }) => choices.ios ?? choices.native ?? choices.default,
  },
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  StyleSheet: { create: <Styles>(styles: Styles) => styles, flatten: (style: unknown) => style },
});
const pluginReactNative = hostModule("paseo", {});

type ReplyBoxComponent = (props: Record<string, unknown>) => ReactElement;
let ReplyBox: ReplyBoxComponent;

beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve(PLUGIN_ROOT, "client/reply-box.tsx")],
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    platform: "neutral",
    target: "es2020",
    external: ["react", "react/jsx-runtime", "react-native", "@getpaseo/plugin", "@getpaseo/plugin/*", "@tanstack/react-query", "zod"],
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0]?.text ?? "";
  const requireHost = (specifier: string): unknown => {
    if (specifier === "react-native") return reactNative;
    if (specifier === "@getpaseo/plugin/client/react-native") return pluginReactNative;
    if (specifier.startsWith("@getpaseo/plugin")) return hostModule("plugin", {});
    return nodeRequire(specifier);
  };
  const module = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", code)(requireHost, module, module.exports);
  ReplyBox = module.exports.ReplyBox as ReplyBoxComponent;
});

const theme = {
  colors: new Proxy({}, { get: () => "#808080" }),
};

/** The native field as the phone app would drive it: focus state, and every set of props it was handed. */
function nativeField() {
  let focused = false;
  return {
    get focused() {
      return focused;
    },
    focus: () => {
      focused = true;
    },
    blur: () => {
      focused = false;
    },
    isFocused: () => focused,
  };
}

interface Harness {
  renderer: ReactTestRenderer;
  /** Every render of the native field: whether it was handed text (a write) and its mount. */
  renders: { value: unknown; defaultValue: unknown; field: ReactTestInstance }[];
  type: (text: string) => void;
  /** The owner sets its draft from outside, as a send clearing it or a draft put back does. */
  setFromOutside: (text: string) => void;
  draft: () => string;
  field: ReturnType<typeof nativeField>;
}

function mount(initial = "", props: Record<string, unknown> = {}): Harness {
  const field = nativeField();
  let setDraft: (text: string) => void = () => undefined;
  let current = initial;
  function Owner(): ReactElement {
    const [draft, setDraftState] = useState(initial);
    current = draft;
    setDraft = setDraftState;
    return createElement(ReplyBox, { theme, value: draft, onChangeText: setDraftState, placeholder: "What should change?", onSend: () => undefined, ...props });
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(Owner), { createNodeMock: () => field });
  });
  const renders: Harness["renders"] = [];
  const nativeInput = () => renderer.root.find((node: ReactTestInstance) => (node.type as unknown) === "paseo.TextInput");
  const record = () => {
    const input = nativeInput();
    renders.push({ value: input.props.value, defaultValue: input.props.defaultValue, field: input });
  };
  record();
  return {
    renderer,
    renders,
    type: (text) => {
      act(() => {
        (nativeInput().props.onChangeText as (text: string) => void)(text);
      });
      record();
    },
    setFromOutside: (text) => {
      act(() => setDraft(text));
      record();
    },
    draft: () => current,
    field,
  };
}

/** Text writes JavaScript sent the native field: a `value` on any render, or new text on a remount. */
function textWrites(harness: Harness): number {
  return harness.renders.filter((render) => render.value !== undefined).length;
}

describe("the reply box on a phone (TR-125)", () => {
  it("sends the native field no text while 2,000 characters are typed one by one", () => {
    const harness = mount();
    const firstField = harness.renders[0]?.field;
    let typed = "";
    for (const character of "Please split the change box into two steps. ".repeat(50).slice(0, 2_000)) {
      typed += character;
      harness.type(typed);
    }
    expect(typed).toHaveLength(2_000);
    // The owner still hears the typing (its Send button and the kept draft follow the text).
    expect(harness.draft()).toBe(typed);
    // Before TR-125 every keystroke wrote the text back: 2,001 writes, one per render.
    expect(textWrites(harness)).toBe(0);
    // The same native field throughout: typing never remounts it.
    expect(harness.renders.every((render) => render.field === firstField)).toBe(true);
    expect(harness.renders.every((render) => render.defaultValue === "")).toBe(true);
  });

  it("starts the field with a kept draft", () => {
    const harness = mount("A half-written reply");
    expect(harness.renders[0]?.defaultValue).toBe("A half-written reply");
    expect(textWrites(harness)).toBe(0);
  });

  it("empties the field when the owner clears the draft on send, keeping the focus", () => {
    const harness = mount();
    harness.field.focus();
    harness.type("Ship it");
    harness.setFromOutside("");
    const last = harness.renders[harness.renders.length - 1];
    expect(last?.defaultValue).toBe("");
    expect(last?.field.props.autoFocus).toBe(true);
    expect(last?.field).not.toBe(harness.renders[0]?.field);
  });

  it("shows a draft put back or switched from outside", () => {
    const harness = mount();
    harness.type("first");
    harness.setFromOutside("the failed message, put back");
    const last = harness.renders[harness.renders.length - 1];
    expect(last?.defaultValue).toBe("the failed message, put back");
    expect(last?.field.props.autoFocus).toBe(false);
    // Typing on carries on in the new field without writes.
    harness.type("the failed message, put back!");
    expect(textWrites(harness)).toBe(0);
    expect(harness.draft()).toBe("the failed message, put back!");
  });

  it("keeps the caller's autoFocus for the first field", () => {
    const harness = mount("", { autoFocus: true });
    expect(harness.renders[0]?.field.props.autoFocus).toBe(true);
  });

  it("leaves the web and desktop field as it was: it shows the owner's draft on every render", () => {
    platform.OS = "web";
    try {
      const harness = mount();
      harness.type("a");
      harness.type("ab");
      expect(harness.renders.map((render) => render.value)).toEqual(["", "a", "ab"]);
    } finally {
      platform.OS = "ios";
    }
  });
});
