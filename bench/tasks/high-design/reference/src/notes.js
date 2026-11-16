import { dayNumber, parseDue, today } from "./due.js";

/** Tags are kept as typed, trimmed; an empty one is dropped. */
function cleanTags(tags) {
  return (tags ?? []).map((tag) => tag.trim()).filter((tag) => tag !== "");
}

/** Adds a note to the state and returns it. `now` is a Date, so tests can fix the time. */
export function addNote(state, { title, body = "", tags = [], due }, now = new Date()) {
  if (typeof title !== "string" || title.trim() === "") throw new Error("a note needs a title");
  const note = { id: state.nextId, title: title.trim(), body, tags: cleanTags(tags), created: now.toISOString(), updated: now.toISOString() };
  const dueDate = due === undefined ? null : parseDue(due);
  if (dueDate !== null) note.due = dueDate;
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
  if (changes.due !== undefined) {
    const dueDate = parseDue(changes.due);
    if (dueDate === null) delete note.due;
    else note.due = dueDate;
  }
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

/** Marks a note done today. Returns false when it already was (its done date stays). */
export function markDone(state, id) {
  const note = getNote(state, id);
  if (note.done !== undefined) return { note, changed: false };
  note.done = today();
  return { note, changed: true };
}

/** Takes the done mark off. Returns false when the note was not done. */
export function markUndone(state, id) {
  const note = getNote(state, id);
  if (note.done === undefined) return { note, changed: false };
  delete note.done;
  return { note, changed: true };
}

/** The agenda's groups for `day` (`YYYY-MM-DD`): notes with a due date that are not done, by due date then id. */
export function agendaGroups(state, day, { tag } = {}) {
  const today = dayNumber(day);
  const groups = [["Overdue", []], ["Today", []], ["Next 7 days", []], ["Later", []]];
  listNotes(state, { tag })
    .filter((note) => note.due !== undefined && note.done === undefined)
    .sort((left, right) => (dayNumber(left.due) - dayNumber(right.due)) || (left.id - right.id))
    .forEach((note) => {
      const ahead = dayNumber(note.due) - today;
      groups[ahead < 0 ? 0 : ahead === 0 ? 1 : ahead <= 7 ? 2 : 3][1].push({ note, ahead });
    });
  return groups.filter(([, entries]) => entries.length > 0);
}
