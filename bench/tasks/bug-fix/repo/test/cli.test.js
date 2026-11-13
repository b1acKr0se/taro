import assert from "node:assert/strict";
import { test } from "node:test";

import { freshFile, notes } from "./helpers.js";

test("add, list and show", () => {
  const file = freshFile();
  assert.deepEqual(notes(file, "add", "Buy", "milk", "--body", "2 litres", "--tag", "home"), { code: 0, out: "added #1\n", err: "" });
  assert.match(notes(file, "list").out, /^#1  Buy milk  \[home\]\n$/);
  assert.match(notes(file, "show", "1").out, /^#1 Buy milk\ntags: home\n/);
});

test("list on an empty store", () => {
  assert.equal(notes(freshFile(), "list").out, "No notes.\n");
});

test("list --tag keeps the notes with that tag", () => {
  const file = freshFile();
  notes(file, "add", "a", "--tag", "home");
  notes(file, "add", "b", "--tag", "work");
  assert.equal(notes(file, "list", "--tag", "work").out, "#2  b  [work]\n");
});

test("edit changes a note", () => {
  const file = freshFile();
  notes(file, "add", "a");
  assert.equal(notes(file, "edit", "1", "--title", "b").out, "edited #1\n");
  assert.match(notes(file, "show", "1").out, /^#1 b\n/);
});

test("rm removes a note", () => {
  const file = freshFile();
  notes(file, "add", "a");
  assert.equal(notes(file, "rm", "1").out, "removed #1\n");
  assert.equal(notes(file, "list").out, "No notes.\n");
});

test("a problem exits 1 with the reason on stderr", () => {
  const file = freshFile();
  assert.deepEqual(notes(file, "show", "7"), { code: 1, out: "", err: "no note 7\n" });
  assert.equal(notes(file, "add").code, 1);
  assert.equal(notes(file, "add", "x", "--body").err, "--body needs a value\n");
});

test("an unknown command prints the usage and exits 1; help exits 0", () => {
  const file = freshFile();
  assert.equal(notes(file, "frobnicate").code, 1);
  assert.match(notes(file, "frobnicate").err, /usage: notes/);
  assert.equal(notes(file, "help").code, 0);
});

test("rm --tag removes the notes with that tag and says how many", () => {
  const file = freshFile();
  notes(file, "add", "a", "--tag", "home");
  notes(file, "add", "b", "--tag", "home");
  notes(file, "add", "c", "--tag", "work");
  assert.equal(notes(file, "rm", "--tag", "home").out, "removed 2 notes\n");
  assert.equal(notes(file, "list").out, "#3  c  [work]\n");
  assert.equal(notes(file, "rm", "--tag", "work").out, "removed 1 note\n");
});

test("count and tags", () => {
  const file = freshFile();
  assert.equal(notes(file, "tags").out, "No tags.\n");
  notes(file, "add", "a", "--tag", "home", "--tag", "work");
  notes(file, "add", "b", "--tag", "work");
  assert.equal(notes(file, "count").out, "2\n");
  assert.equal(notes(file, "count", "--tag", "home").out, "1\n");
  assert.equal(notes(file, "tags").out, "work  2\nhome  1\n");
});
