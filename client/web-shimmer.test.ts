import { afterEach, describe, expect, it, vi } from "vitest";

import { SHIMMER_GRADIENT } from "./shimmer";
import { startWebShimmer, watchWebShimmer, webShimmerSupported, type ShimmerElement } from "./web-shimmer";

/**
 * An element at `left`–`right` in the page drawing `text` itself (or only holding other elements),
 * its letters ending at `lettersEnd` when given.
 */
function element(left: number, right: number, text: string | null, lettersEnd?: number) {
  const styles = new Map<string, string>();
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  const node: ShimmerElement = {
    getBoundingClientRect: () => ({ left, right }),
    childNodes: text === null ? [{ nodeType: 1, textContent: "" }] : [{ nodeType: 3, textContent: text }],
    style: { setProperty: (name, value) => styles.set(name, value) },
    animate,
    ...(lettersEnd === undefined ? {} : { ownerDocument: { createRange: () => ({ selectNodeContents: () => undefined, getBoundingClientRect: () => ({ right: lettersEnd }) }) } }),
  };
  return { node, styles, animate, cancel };
}

/** A copy of the words starting at x = 100 in the page. */
function row(...children: ReturnType<typeof element>[]) {
  return { getBoundingClientRect: () => ({ left: 100, right: 700 }), querySelectorAll: () => children.map((child) => child.node) };
}

describe("startWebShimmer (TR-184)", () => {
  it("clips Paseo's gradient to the letters of a copy with no fill of its own", () => {
    const label = element(100, 140, "Shell");
    startWebShimmer(row(label), 1200);
    expect(label.styles.get("-webkit-text-fill-color")).toBe("transparent");
    expect(label.styles.get("background-image")).toBe(SHIMMER_GRADIENT);
    expect(label.styles.get("background-clip")).toBe("text");
    expect(label.styles.get("-webkit-background-clip")).toBe("text");
    expect(label.styles.get("background-repeat")).toBe("no-repeat");
    expect(label.styles.get("opacity")).toBe("1");
  });

  it("runs one band across label and command, each placed by its offset in the row", () => {
    // Label at 0–40 and command at 50–400 in the row: the band is 88 wide (22% of the 400 they span), from -88 to 400.
    const label = element(100, 140, "Shell");
    const command = element(150, 500, "npm test -- --run");
    startWebShimmer(row(label, command), 1500);
    expect(label.styles.get("background-size")).toBe("88px 100%");
    expect(label.animate).toHaveBeenCalledWith([{ backgroundPosition: "-88px 0" }, { backgroundPosition: "400px 0" }], { duration: 1500, iterations: Infinity, easing: "linear" });
    expect(command.animate).toHaveBeenCalledWith([{ backgroundPosition: "-138px 0" }, { backgroundPosition: "350px 0" }], { duration: 1500, iterations: Infinity, easing: "linear" });
  });

  it("ends the band at the last letter of a command stretched to the row's end, as Paseo's does", () => {
    // The command's box runs to 700, its letters to 200: the span is 0–100, so the band is 42 wide (its least).
    const label = element(100, 140, "Shell");
    const command = element(150, 700, "sleep 6", 200);
    startWebShimmer(row(label, command), 1000);
    expect(label.styles.get("background-size")).toBe("42px 100%");
    expect(label.animate).toHaveBeenCalledWith([{ backgroundPosition: "-42px 0" }, { backgroundPosition: "100px 0" }], expect.anything());
  });

  it("ends it at the box's edge where the text is cut with …", () => {
    const command = element(100, 300, "npm test -- --run --reporter verbose", 900);
    startWebShimmer(row(command), 1000);
    expect(command.animate).toHaveBeenCalledWith([{ backgroundPosition: "-44px 0" }, { backgroundPosition: "200px 0" }], expect.anything());
  });

  it("leaves elements alone that only hold others or blank text", () => {
    const wrapper = element(100, 500, null);
    const blank = element(100, 110, "  ");
    const label = element(110, 150, "Read");
    startWebShimmer(row(wrapper, blank, label), 1000);
    expect(wrapper.styles.size).toBe(0);
    expect(blank.styles.size).toBe(0);
    expect(label.animate).toHaveBeenCalledTimes(1);
  });

  it("stops every slide when stopped", () => {
    const label = element(100, 140, "Shell");
    const command = element(150, 300, "ls");
    const stop = startWebShimmer(row(label, command), 1000);
    stop();
    expect(label.cancel).toHaveBeenCalledTimes(1);
    expect(command.cancel).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a phone, whose view is no DOM element, or with no words", () => {
    expect(() => startWebShimmer(null, 1000)()).not.toThrow();
    expect(() => startWebShimmer({ setNativeProps: () => undefined }, 1000)()).not.toThrow();
    expect(() => startWebShimmer(row(), 1000)()).not.toThrow();
  });
});

describe("webShimmerSupported", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("needs text clipping, prefixed or not, and Web Animations", () => {
    vi.stubGlobal("Element", { prototype: { animate: () => undefined } });
    vi.stubGlobal("CSS", { supports: (property: string) => property === "-webkit-background-clip" });
    expect(webShimmerSupported()).toBe(true);
    vi.stubGlobal("CSS", { supports: () => false });
    expect(webShimmerSupported()).toBe(false);
    vi.stubGlobal("CSS", { supports: () => true });
    vi.stubGlobal("Element", { prototype: {} });
    expect(webShimmerSupported()).toBe(false);
  });

  it("is false where there is no CSS, as on a phone", () => {
    vi.stubGlobal("CSS", undefined);
    expect(webShimmerSupported()).toBe(false);
  });
});

describe("watchWebShimmer (TR-184)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A browser's MutationObserver, fired by hand; its callback runs before the browser paints. */
  function mutations() {
    const made: { callback: () => void; options: unknown; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal("MutationObserver", function MutationObserver(this: unknown, callback: () => void) {
      const observer = { callback, options: undefined as unknown, disconnect: vi.fn() };
      made.push(observer);
      return { observe: (_target: unknown, options: unknown) => (observer.options = options), disconnect: observer.disconnect };
    });
    return made;
  }

  it("styles words that appear in the copy after it started, such as a sub-agent's activity arriving", () => {
    const made = mutations();
    const label = element(100, 140, "Task");
    const children = [label];
    const copy = { getBoundingClientRect: () => ({ left: 100, right: 700 }), querySelectorAll: () => children.map((child) => child.node) };
    watchWebShimmer(copy, 1000);
    const activity = element(150, 400, "Reading the notes list");
    children.push(activity);
    made[0]?.callback();
    expect(activity.styles.get("-webkit-text-fill-color")).toBe("transparent");
    expect(activity.animate).toHaveBeenCalledTimes(1);
    // The band now ends at the activity's last letter, and the label's old slide is stopped.
    expect(label.cancel).toHaveBeenCalledTimes(1);
    expect(label.animate).toHaveBeenLastCalledWith([{ backgroundPosition: "-66px 0" }, { backgroundPosition: "300px 0" }], expect.anything());
  });

  it("watches the words, never the attributes its own styles change", () => {
    const made = mutations();
    watchWebShimmer(row(element(100, 140, "Shell")), 1000);
    expect(made[0]?.options).toEqual({ childList: true, subtree: true, characterData: true });
  });

  it("stops watching and sliding when stopped", () => {
    const made = mutations();
    const label = element(100, 140, "Shell");
    const stop = watchWebShimmer(row(label), 1000);
    stop();
    expect(made[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(label.cancel).toHaveBeenCalledTimes(1);
  });

  it("still shimmers where there is no MutationObserver, and does nothing on a phone", () => {
    vi.stubGlobal("MutationObserver", undefined);
    const label = element(100, 140, "Shell");
    watchWebShimmer(row(label), 1000)();
    expect(label.animate).toHaveBeenCalledTimes(1);
    expect(label.cancel).toHaveBeenCalledTimes(1);
    expect(() => watchWebShimmer(null, 1000)()).not.toThrow();
  });
});
