/** The identity of a note's content: the same note in two files has the same title, body, tags and creation time. */
function contentKey(note) {
  return JSON.stringify([note.title, note.body, note.tags, note.created]);
}

/**
 * Adds the notes of `other` to `state`. A note already there (same content, any number) is skipped; one whose
 * number is free keeps it; one whose number is taken by another note gets the next unused number, counting up
 * from beyond every number either file has used. Returns `{ added, already, renumbered }`.
 */
export function mergeNotes(state, other) {
  const known = new Set(state.notes.map(contentKey));
  const taken = new Set(state.notes.map((note) => note.id));
  let next = Math.max(state.nextId, other.nextId);
  const added = [];
  const renumbered = [];
  let already = 0;
  [...other.notes].sort((left, right) => left.id - right.id).forEach((note) => {
    if (known.has(contentKey(note))) {
      already += 1;
      return;
    }
    const id = taken.has(note.id) ? next++ : note.id;
    if (id !== note.id) renumbered.push({ from: note.id, to: id, title: note.title });
    taken.add(id);
    known.add(contentKey(note));
    added.push({ ...note, id });
  });
  state.notes.push(...added);
  state.nextId = Math.max(next, state.nextId, ...state.notes.map((note) => note.id + 1));
  return { added: added.length, already, renumbered };
}
