import { Component, createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { createCrashRecorder } from "./crash-recorder";
import { ErrorBoundary, type ErrorBoundaryProps } from "./error-boundary";

const fallback = createElement("fallback");
const child = createElement("child");

function boundary(props: Partial<ErrorBoundaryProps> = {}) {
  return new ErrorBoundary({ label: "image viewer", fallback, children: child, ...props });
}

describe("ErrorBoundary", () => {
  it("is a component React treats as a class, without class syntax", () => {
    const instance = boundary();
    expect(instance).toBeInstanceOf(Component);
    expect(instance).toBeInstanceOf(ErrorBoundary);
    expect((ErrorBoundary.prototype as { isReactComponent?: unknown }).isReactComponent).toBeDefined();
    expect(instance.props.label).toBe("image viewer");
    expect(typeof instance.setState).toBe("function");
  });

  it("draws its children until something under it fails", () => {
    const instance = boundary();
    expect(instance.state).toEqual({ failed: false });
    expect(instance.render()).toBe(child);
    expect(boundary({ children: undefined }).render()).toBeNull();
  });

  it("draws the fallback once a failure is caught", () => {
    const error = new TypeError("window.onResized(...).then is not a function");
    const failed = ErrorBoundary.getDerivedStateFromError?.(error);
    expect(failed).toEqual({ failed: true, error });
    const instance = boundary();
    instance.state = { ...instance.state, ...failed };
    expect(instance.render()).toBe(fallback);
  });

  it("logs the failure and its label without throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = new Error("boom");
    expect(() => boundary().componentDidCatch?.(error, { componentStack: "\n    in GalleryPage" })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("image viewer"), error, "\n    in GalleryPage");
    warn.mockRestore();
  });

  it("without a fallback, passes the failure on to the boundary above", () => {
    const error = new Error("render failed");
    const instance = boundary({ fallback: undefined });
    instance.state = { failed: true, error };
    const passed = instance.render() as { type: (props: { error: unknown }) => unknown; props: { error: unknown } };
    expect(passed.props.error).toBe(error);
    expect(() => passed.type(passed.props)).toThrow(error);
  });

  it("records a failure it replaces with its fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    boundary({ label: "image viewer" }).componentDidCatch?.(new Error("viewer failed"), { componentStack: "" });
    warn.mockRestore();
    // The recorder's slot is on globalThis: a second recorder there sees what the boundary recorded.
    const sent: unknown[] = [];
    createCrashRecorder().setSender(async (report) => {
      sent.push(report);
    });
    await Promise.resolve();
    expect(JSON.stringify(sent)).toContain("viewer failed");
    expect(JSON.stringify(sent)).toContain("image viewer");
  });
});

describe("ErrorBoundary under React", () => {
  // React drops a boundary whose own error render throws before its commit, so `componentDidCatch`
  // never runs there (TR-132 review); this renders for real to prove the failure is still recorded.
  it("records a render failure it passes on, once, and the boundary above still catches it", async () => {
    const { act, create } = await import("react-test-renderer");
    const caughtAbove: unknown[] = [];
    function Outer(this: Component<{ children?: unknown }, { failed: boolean }>, props: { children?: unknown }) {
      (Component as unknown as (this: unknown, props: unknown) => void).call(this, props);
      this.state = { failed: false };
    }
    Outer.prototype = Object.create(Component.prototype, { constructor: { value: Outer, writable: true, configurable: true } });
    (Outer as unknown as { getDerivedStateFromError: (error: unknown) => unknown }).getDerivedStateFromError = (error: unknown) => {
      caughtAbove.push(error);
      return { failed: true };
    };
    Outer.prototype.render = function (this: { state: { failed: boolean }; props: { children?: unknown } }) {
      return this.state.failed ? createElement("plugin-failed") : this.props.children;
    };
    const failure = new Error("Taro screen render failed");
    function Broken(): never {
      throw failure;
    }
    const sent: string[] = [];
    createCrashRecorder().setSender(async (report) => {
      sent.push(JSON.stringify(report));
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        createElement(Outer as never, null, createElement(ErrorBoundary, { label: "Taro screen", children: createElement(Broken) })),
      );
    });
    await Promise.resolve();
    quiet.mockRestore();
    warn.mockRestore();
    expect(caughtAbove).toContain(failure);
    expect((renderer as unknown as { toJSON(): { type: string } }).toJSON().type).toBe("plugin-failed");
    const recorded = sent.join("\n").split('"message":"Error: Taro screen render failed"').length - 1;
    expect(recorded).toBe(1);
    expect(sent.join("\n")).toContain('"where":"Taro screen"');
  });
});
