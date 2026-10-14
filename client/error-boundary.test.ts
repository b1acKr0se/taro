import { Component, createElement } from "react";
import { describe, expect, it, vi } from "vitest";

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
    const failed = ErrorBoundary.getDerivedStateFromError?.(new TypeError("window.onResized(...).then is not a function"));
    expect(failed).toEqual({ failed: true });
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

});
