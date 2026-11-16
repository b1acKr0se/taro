import assert from "node:assert/strict";
import { test } from "node:test";

import { addNote, editNote, getNote, listNotes, removeNote } from "../src/notes.js";

const NOW = new Date("2026-01-05T10:00:00Z");
const LATER = new Date("2026-01-06T10:00:00Z");

function stateWith(...titles) {
  const state = { nextId: 1, notes: [] };
  titles.forEach((title) => addNote(state, { title }, NOW));
  return state;
}

test("adds a note with the next id and the time", () => {
  const state = stateWith();
  const note = addNote(state, { title: "  Buy milk ", body: "2 litres", tags: [" home ", ""] }, NOW);
  assert.deepEqual(note, { id: 1, title: "Buy milk", body: "2 litres", tags: ["home"], created: "2026-01-05T10:00:00.000Z", updated: "2026-01-05T10:00:00.000Z" });
  assert.equal(state.nextId, 2);
});

test("a note needs a title", () => {
  assert.throws(() => addNote(stateWith(), { title: "   " }), /needs a title/);
  assert.throws(() => addNote(stateWith(), {}), /needs a title/);
});

test("ids are never reused after a removal", () => {
  const state = stateWith("a", "b");
  removeNote(state, 2);
  assert.equal(addNote(state, { title: "c" }, NOW).id, 3);
});

test("getNote names a missing id", () => {
  assert.throws(() => getNote(stateWith("a"), 9), /no note 9/);
});

test("edits only the fields given and stamps the time", () => {
  const state = stateWith("a");
  const note = editNote(state, "1", { body: "text" }, LATER);
  assert.equal(note.title, "a");
  assert.equal(note.body, "text");
  assert.equal(note.created, "2026-01-05T10:00:00.000Z");
  assert.equal(note.updated, "2026-01-06T10:00:00.000Z");
});

test("an edit cannot empty the title", () => {
  assert.throws(() => editNote(stateWith("a"), 1, { title: " " }), /needs a title/);
});

test("removes a note", () => {
  const state = stateWith("a", "b");
  assert.equal(removeNote(state, 1).title, "a");
  assert.deepEqual(state.notes.map((note) => note.id), [2]);
});

test("lists in id order and filters by tag", () => {
  const state = stateWith();
  addNote(state, { title: "b", tags: ["home"] }, NOW);
  addNote(state, { title: "a", tags: ["work"] }, NOW);
  assert.deepEqual(listNotes(state).map((note) => note.id), [1, 2]);
  assert.deepEqual(listNotes(state, { tag: "work" }).map((note) => note.title), ["a"]);
});
