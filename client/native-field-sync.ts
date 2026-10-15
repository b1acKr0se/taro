/**
 * Which drafts a phone's reply box hears back from its owner are its own typing (TR-125). On the
 * phone the field keeps its own text: a controlled field (`value` on every keystroke) races the
 * native text whenever JavaScript falls behind the keyboard, which long text in a busy pane does,
 * and that race crashed the whole app. So the field only reports what it holds, and a draft its
 * owner hands back is checked here: one the field reported is an echo and changes nothing; any
 * other was set from outside (cleared on send, a draft put back or switched), and the field takes it.
 * Pure, for vitest.
 */

/** Echoes kept at most: an owner that never hands the draft back (a busy box) must not grow this forever. */
const MAX_PENDING = 50;

export interface NativeFieldSync {
  /** The field reported this text (the reader typed it). */
  typed(text: string): void;
  /** The owner's draft, on each render: true when it was set from outside and the field must take it. */
  outside(value: string): boolean;
}

export function createNativeFieldSync(initial: string): NativeFieldSync {
  /** What the field holds now. */
  let held = initial;
  /** Texts the field reported that the owner has not handed back yet, oldest first. */
  let pending: string[] = [];
  /** The last draft the owner handed in, so a render that changed nothing is not checked again. */
  let last = initial;
  return {
    typed(text) {
      held = text;
      pending.push(text);
      if (pending.length > MAX_PENDING) pending = pending.slice(pending.length - MAX_PENDING);
    },
    outside(value) {
      if (value === last) return false;
      last = value;
      // An echo, perhaps a late one: the owner caught up to this point of the typing.
      const echoed = pending.lastIndexOf(value);
      if (echoed !== -1) {
        pending = pending.slice(echoed + 1);
        return false;
      }
      pending = [];
      if (value === held) return false;
      held = value;
      return true;
    },
  };
}
