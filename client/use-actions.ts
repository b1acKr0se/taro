/**
 * A group of buttons that send something (TR-058), on one card or row: `press` runs a call through one
 * press guard, `stateOf` gives each button its busy or done look, `busy` disables the rest of the group,
 * and a failure becomes an error toast with its reason.
 */
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";

import { errorText } from "./format";
import { createPressGuard, press, type AfterSuccess, type PressGuard, type PressShown } from "./press-guard";
import { sharedPresses } from "./shared-presses";

export interface PressOptions<Value> {
  /** "hold" where success makes the button leave: it stays busy until then instead of showing a check. */
  after?: AfterSuccess;
  /** A success toast, for calls whose result shows nowhere else. */
  success?: string;
  onSuccess?: (value: Value) => void;
  /** Says the reason somewhere other than an error toast. */
  onError?: (error: unknown) => void;
}

export interface Actions {
  press<Value>(key: string, action: () => Promise<Value>, options?: PressOptions<Value>): void;
  stateOf(key: string): "busy" | "done" | undefined;
  /** A press is unsettled: the group's other buttons are disabled. */
  busy: boolean;
}

/**
 * `call` (`acceptanceCall`, `decisionCall`) shares the group's guard with every other surface showing the
 * same call (TR-191): a press on one shows busy on all. Without it the guard is this group's own.
 */
export function useActions(call?: string): Actions {
  const toast = useToast();
  const [ownShown, setOwnShown] = useState<PressShown | null>(null);
  const [sharedShown, setSharedShown] = useState<{ call: string; shown: PressShown | null } | null>(null);
  const guard = useRef<PressGuard | null>(null);
  // Made on first press and dropped on unmount, so a remount (React's strict mode) gets a live one.
  useEffect(
    () => () => {
      guard.current?.dispose();
      guard.current = null;
    },
    [],
  );
  useEffect(() => {
    if (call === undefined) return undefined;
    const presses = sharedPresses();
    setSharedShown({ call, shown: presses.shown(call) });
    return presses.subscribe(call, (shown) => setSharedShown({ call, shown }));
  }, [call]);
  // Read straight from the registry until the subscription catches up, so a surface opened mid-press is busy at once.
  const shown = call === undefined ? ownShown : sharedShown !== null && sharedShown.call === call ? sharedShown.shown : sharedPresses().shown(call);
  return {
    press(key, action, options = {}) {
      if (call === undefined && guard.current === null) guard.current = createPressGuard({ onChange: setOwnShown });
      const group = call === undefined ? guard.current : sharedPresses().guardFor(call);
      if (group === null) return;
      press(group, key, action, {
        after: options.after,
        onSuccess: (value) => {
          if (options.success !== undefined) toast.show(options.success, { variant: "success" });
          options.onSuccess?.(value);
        },
        onError: options.onError ?? ((caught) => toast.error(errorText(caught))),
      });
    },
    stateOf: (key) => (shown !== null && shown.key === key ? shown.phase : undefined),
    // Held after success too (a button about to leave), which the shown phase alone would not say.
    busy: shown !== null && shown.phase === "busy",
  };
}

/**
 * Press guards for controls that draw their own sending look (option chips, suggestion pills, the
 * composer's Send): one guard per key, made when first asked for, so each control ignores a second
 * press until its call settles.
 */
export function usePressGuards(): (key: string) => PressGuard {
  const guards = useRef<Map<string, PressGuard> | null>(null);
  useEffect(
    () => () => {
      guards.current?.forEach((guard) => guard.dispose());
      guards.current = null;
    },
    [],
  );
  return (key) => {
    if (guards.current === null) guards.current = new Map();
    const known = guards.current.get(key);
    if (known !== undefined) return known;
    const made = createPressGuard();
    guards.current.set(key, made);
    return made;
  };
}
