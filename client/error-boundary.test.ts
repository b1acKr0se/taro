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

  it("records every failure it catches in the crash trail, quietly when it passes it on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    boundary({ label: "Taro screen", fallback: undefined }).componentDidCatch?.(new Error("render failed"), { componentStack: "" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    // The recorder's slot is on globalThis: a second recorder there sees what the boundary recorded.
    const sent: unknown[] = [];
    createCrashRecorder().setSender(async (report) => {
      sent.push(report);
    });
    await Promise.resolve();
    expect(JSON.stringify(sent)).toContain("render failed");
    expect(JSON.stringify(sent)).toContain("Taro screen");
  });
});
