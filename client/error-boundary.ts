/**
 * Keeps a failure inside one surface (TR-054): an error thrown while rendering `children`, or in one of
 * their effects, shows `fallback` instead of reaching Paseo's plugin boundary, which replaces the whole
 * plugin with "Plugin failed". React catches errors only in a class component, and the client may not
 * use class syntax (Hermes, TR-023), so this is a constructor function on `Component`'s prototype, as
 * React's own `Component` is written. It starts over when it is mounted again.
 */
import { Component, type ComponentClass, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  /** What failed, for the log. */
  label: string;
  fallback: ReactNode;
  children?: ReactNode;
}

export interface ErrorBoundaryState {
  failed: boolean;
}

type Boundary = Component<ErrorBoundaryProps, ErrorBoundaryState>;

function ErrorBoundaryComponent(this: Boundary, props: ErrorBoundaryProps): void {
  (Component as unknown as (this: Boundary, props: ErrorBoundaryProps) => void).call(this, props);
  this.state = { failed: false };
}

ErrorBoundaryComponent.prototype = Object.create(Component.prototype, {
  constructor: { value: ErrorBoundaryComponent, writable: true, configurable: true },
}) as Boundary;

ErrorBoundaryComponent.getDerivedStateFromError = function (): ErrorBoundaryState {
  return { failed: true };
};

ErrorBoundaryComponent.prototype.componentDidCatch = function (this: Boundary, error: unknown, info: ErrorInfo): void {
  console.warn(`[taro] the ${this.props.label} failed and was replaced by its fallback`, error, info.componentStack);
};

ErrorBoundaryComponent.prototype.render = function (this: Boundary): ReactNode {
  return this.state.failed ? this.props.fallback : (this.props.children ?? null);
};

export const ErrorBoundary = ErrorBoundaryComponent as unknown as ComponentClass<ErrorBoundaryProps, ErrorBoundaryState>;
