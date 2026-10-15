/**
 * Keeps a failure inside one surface (TR-054): an error thrown while rendering `children`, or in one of
 * their effects, shows `fallback` instead of reaching Paseo's plugin boundary, which replaces the whole
 * plugin with "Plugin failed". React catches errors only in a class component, and the client may not
 * use class syntax (Hermes, TR-023), so this is a constructor function on `Component`'s prototype, as
 * React's own `Component` is written. It starts over when it is mounted again. Every failure it catches
 * goes into the crash trail (TR-132); without a `fallback` it records the failure and throws it on to the
 * boundary above, Paseo's, so what the user sees does not change.
 */
import { Component, createElement, type ComponentClass, type ErrorInfo, type ReactNode } from "react";

import { crashRecorder } from "./crash-recorder";

export interface ErrorBoundaryProps {
  /** What failed, for the log. */
  label: string;
  /** What to draw instead; undefined passes the failure on to the boundary above. */
  fallback?: ReactNode;
  children?: ReactNode;
}

export interface ErrorBoundaryState {
  failed: boolean;
  error?: unknown;
}

type Boundary = Component<ErrorBoundaryProps, ErrorBoundaryState> & { recordedError?: unknown };

function ErrorBoundaryComponent(this: Boundary, props: ErrorBoundaryProps): void {
  (Component as unknown as (this: Boundary, props: ErrorBoundaryProps) => void).call(this, props);
  this.state = { failed: false };
}

ErrorBoundaryComponent.prototype = Object.create(Component.prototype, {
  constructor: { value: ErrorBoundaryComponent, writable: true, configurable: true },
}) as Boundary;

ErrorBoundaryComponent.getDerivedStateFromError = function (error: unknown): ErrorBoundaryState {
  return { failed: true, error };
};

/** Throws a caught failure again while rendering, so the boundary above catches it. */
function PassOn({ error }: { error: unknown }): ReactNode {
  throw error;
}

function record(label: string, error: unknown): void {
  try {
    crashRecorder().error("boundary", label, error);
  } catch {
    // Tracing never adds a failure of its own.
  }
}

ErrorBoundaryComponent.prototype.componentDidCatch = function (this: Boundary, error: unknown, info: ErrorInfo): void {
  // Only a boundary with a fallback gets here: one that passes the failure on is dropped by React with
  // the render that threw, before its commit, so it records in `render` instead.
  console.warn(`[taro] the ${this.props.label} failed and was replaced by its fallback`, error, info.componentStack);
  record(this.props.label, error);
};

ErrorBoundaryComponent.prototype.render = function (this: Boundary): ReactNode {
  if (!this.state.failed) return this.props.children ?? null;
  if (this.props.fallback !== undefined) return this.props.fallback;
  // React may render a failed boundary more than once (a retry); one failure is one record.
  if (this.state.error !== this.recordedError) {
    this.recordedError = this.state.error;
    record(this.props.label, this.state.error);
  }
  return createElement(PassOn, { error: this.state.error });
};

export const ErrorBoundary = ErrorBoundaryComponent as unknown as ComponentClass<ErrorBoundaryProps, ErrorBoundaryState>;
