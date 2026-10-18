import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkingElapsed } from "./use-working-elapsed";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const START = Date.parse("2026-01-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
/** The hook redraws a moment after each change, so a timer firing early still sees the new text. */
const PAST = 100;

// React's act() expects this flag outside a test framework it knows.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let shown: string | null = null;
function Clock({ turnStartedAt }: { turnStartedAt: string | null }) {
  shown = useWorkingElapsed(turnStartedAt);
  return null;
}

function mount(turnStartedAt: string | null): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(createElement(Clock, { turnStartedAt }));
  });
  if (renderer === undefined) throw new Error("not rendered");
  return renderer;
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useWorkingElapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    shown = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads <1m, then moves to 1m at the minute and 2m at the next, with no reload", () => {
    const renderer = mount(iso(START));
    expect(shown).toBe("<1m");
    advance(59 * SECOND);
    expect(shown).toBe("<1m");
    advance(SECOND + PAST);
    expect(shown).toBe("1m");
    advance(MINUTE);
    expect(shown).toBe("2m");
    act(() => renderer.unmount());
  });

  it("sleeps until the next change, not every second", () => {
    const renderer = mount(iso(START - 90 * MINUTE));
    expect(shown).toBe("1h");
    expect(vi.getTimerCount()).toBe(1);
    advance(29 * MINUTE);
    expect(shown).toBe("1h");
    advance(MINUTE + PAST);
    expect(shown).toBe("2h");
    act(() => renderer.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("measures a new turn from now, not from when the last one last redrew", () => {
    const renderer = mount(iso(START - 2 * HOUR));
    expect(shown).toBe("2h");
    // Most of an hour passes with no redraw; then a new turn starts while the row stays up.
    advance(50 * MINUTE);
    const nextStart = Date.now();
    act(() => renderer.update(createElement(Clock, { turnStartedAt: iso(nextStart) })));
    expect(shown).toBe("<1m");
    advance(MINUTE + PAST);
    expect(shown).toBe("1m");
    act(() => renderer.unmount());
  });

  it("shows nothing and sets no timer when the start is unknown", () => {
    const renderer = mount(null);
    expect(shown).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    act(() => renderer.unmount());
  });
});
