import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test } from "node:test";

import { loadState, saveState } from "../src/store.js";
import { freshFile } from "./helpers.js";

test("a missing file is an empty store", () => {
  assert.deepEqual(loadState(freshFile()), { nextId: 1, notes: [] });
});

test("saves and loads", () => {
  const file = freshFile();
  const state = { nextId: 3, notes: [{ id: 2, title: "x", body: "", tags: [], created: "c", updated: "u" }] };
  saveState(state, file);
  assert.deepEqual(loadState(file), state);
});

test("leaves no temporary file behind", () => {
  const file = freshFile();
  saveState({ nextId: 1, notes: [] }, file);
  assert.deepEqual(readdirSync(dirname(file)), ["notes.json"]);
});

test("creates the folder of the data file", () => {
  const file = `${freshFile()}.d/deeper/notes.json`;
  saveState({ nextId: 1, notes: [] }, file);
  assert.ok(existsSync(file));
});

test("a damaged file is an error naming the file", () => {
  const file = freshFile();
  writeFileSync(file, "{not json");
  assert.throws(() => loadState(file), /is not valid JSON/);
});

test("a file of another shape is an error", () => {
  const file = freshFile();
  writeFileSync(file, JSON.stringify({ hello: 1 }));
  assert.throws(() => loadState(file), /is not a notes file/);
});
