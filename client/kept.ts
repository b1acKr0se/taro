/**
 * State that outlives one evaluation of the client bundle (TR-038).
 *
 * The app drops every plugin of a host when the connection to it drops — the
 * phone going to the background, the network changing — and evaluates the
 * bundle afresh on reconnect, so module scope starts over. The app evaluates
 * bundles in its own global scope, so a slot on `globalThis` is still there for
 * the new evaluation, as the drafts' is (`draft.ts`). Kept for the app's
 * lifetime; not persisted.
 */

function slot(name: string): symbol {
  // A registered symbol, so each evaluation of the bundle names the same slot.
  return Symbol.for(`paseo.taro.${name}`);
}

function sameKind(kept: unknown, fallback: unknown): boolean {
  if (fallback === null) return kept === null || typeof kept !== "object";
  return kept !== null && typeof kept === typeof fallback;
}

/**
 * The object kept on `root` under `name`, shared by every evaluation (Taro on two hosts writes one
 * object), starting from `defaults`. A kept field stays only when `defaults` has it with the same
 * type (a null default stands for any primitive or null), so a bundle that renamed or retyped a
 * field after an update starts that field over instead of reading a stale shape.
 */
export function keptObject<Value extends object>(root: object, name: string, defaults: Value): Value {
  const previous: unknown = Reflect.get(root, slot(name));
  if (typeof previous !== "object" || previous === null) {
    const value = { ...defaults };
    Reflect.set(root, slot(name), value);
    return value;
  }
  for (const key of Object.keys(previous)) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) Reflect.deleteProperty(previous, key);
  }
  for (const key of Object.keys(defaults) as (keyof Value & string)[]) {
    if (!sameKind(Reflect.get(previous, key), defaults[key])) Reflect.set(previous, key, defaults[key]);
  }
  return previous as Value;
}

/** The map kept on `root` under `name`; a new one when none is there. */
export function keptMap<Key, Value>(root: object, name: string): Map<Key, Value> {
  const previous: unknown = Reflect.get(root, slot(name));
  if (previous instanceof Map) return previous as Map<Key, Value>;
  const map = new Map<Key, Value>();
  Reflect.set(root, slot(name), map);
  return map;
}
