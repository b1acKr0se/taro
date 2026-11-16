/** Tags are kept as typed, trimmed; an empty one is dropped. */
function cleanTags(tags) {
  return (tags ?? []).map((tag) => tag.trim()).filter((tag) => tag !== "");
}

/** Adds a note to the state and returns it. `now` is a Date, so tests can fix the time. */
export function addNote(state, { title, body = "", tags = [] }, now = new Date()) {
  if (typeof title !== "string" || title.trim() === "") throw new Error("a note needs a title");
  const note = { id: state.nextId, title: title.trim(), body, tags: cleanTags(tags), created: now.toISOString(), updated: now.toISOString() };
  state.nextId += 1;
  state.notes.push(note);
  return note;
}

/** The note with this id, or an error naming it. */
export function getNote(state, id) {
  const note = state.notes.find((candidate) => candidate.id === Number(id));
  if (note === undefined) throw new Error(`no note ${id}`);
  return note;
}

/** Changes the fields given; the others stay. */
export function editNote(state, id, changes, now = new Date()) {
  const note = getNote(state, id);
  if (changes.title !== undefined) {
    if (changes.title.trim() === "") throw new Error("a note needs a title");
    note.title = changes.title.trim();
  }
  if (changes.body !== undefined) note.body = changes.body;
  if (changes.tags !== undefined) note.tags = cleanTags(changes.tags);
  note.updated = now.toISOString();
  return note;
}

export function removeNote(state, id) {
  const note = getNote(state, id);
  state.notes = state.notes.filter((candidate) => candidate !== note);
  return note;
}

/** Notes in id order, those carrying `tag` when one is given. */
export function listNotes(state, { tag } = {}) {
  const notes = [...state.notes].sort((left, right) => left.id - right.id);
  return tag === undefined ? notes : notes.filter((note) => note.tags.includes(tag));
}
