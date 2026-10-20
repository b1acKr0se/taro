import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "notes.js");

function fresh() {
  return join(mkdtempSync(join(tmpdir(), "notes-hidden-")), "notes.json");
}

function notes(file, ...argv) {
  const result = spawnSync(process.execPath, [BIN, ...argv], { env: { ...process.env, NOTES_FILE: file }, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function seeded() {
  const file = fresh();
  notes(file, "add", "Standup", "--tag", "work");
  notes(file, "add", "Chores", "--tag", "homework");
  notes(file, "add", "Wifi", "--tag", "network");
  notes(file, "add", "Plan", "--tag", "Work", "--tag", "home");
  notes(file, "add", "Plain");
  return file;
}

const titles = (out) => out.split("\n").filter((line) => line !== "").map((line) => line.split("  ")[1]);

test("list --tag shows only notes with that whole tag", () => {
  const file = seeded();
  assert.deepEqual(titles(notes(file, "list", "--tag", "work").out).sort(), ["Plan", "Standup"]);
  assert.deepEqual(titles(notes(file, "list", "--tag", "home").out), ["Plan"]);
  assert.deepEqual(titles(notes(file, "list", "--tag", "homework").out), ["Chores"]);
});

test("count --tag counts whole-tag matches", () => {
  const file = seeded();
  assert.equal(notes(file, "count", "--tag", "work").out, "2\n");
  assert.equal(notes(file, "count", "--tag", "net").out, "0\n");
  assert.equal(notes(file, "count").out, "5\n");
});

test("rm --tag removes only notes with that whole tag", () => {
  const file = seeded();
  assert.equal(notes(file, "rm", "--tag", "work").out, "removed 2 notes\n");
  assert.deepEqual(titles(notes(file, "list").out), ["Chores", "Wifi", "Plain"]);
  assert.equal(notes(file, "rm", "--tag", "home").out, "removed 0 notes\n");
  assert.deepEqual(titles(notes(file, "list").out), ["Chores", "Wifi", "Plain"]);
});

test("rm --tag with a partial tag removes nothing", () => {
  const file = seeded();
  assert.equal(notes(file, "rm", "--tag", "wor").out, "removed 0 notes\n");
  assert.equal(notes(file, "count").out, "5\n");
});

test("P1: matching is case-insensitive", () => {
  const file = seeded();
  assert.deepEqual(titles(notes(file, "list", "--tag", "WORK").out).sort(), ["Plan", "Standup"]);
  assert.deepEqual(titles(notes(file, "list", "--tag", "HOME").out), ["Plan"]);
  assert.equal(notes(file, "count", "--tag", "Work").out, "2\n");
  assert.equal(notes(file, "rm", "--tag", "WORK").out, "removed 2 notes\n");
});

test("P2: stored tags stay as typed, and list and count never write the file", () => {
  const file = seeded();
  const before = readFileSync(file, "utf8");
  notes(file, "list", "--tag", "work");
  notes(file, "count", "--tag", "work");
  notes(file, "list", "--tag", "#WORK");
  assert.equal(readFileSync(file, "utf8"), before);
  assert.match(notes(file, "show", "4").out, /tags: Work, home/);
  notes(file, "rm", "--tag", "network");
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(after.notes.find((note) => note.id === 4).tags, ["Work", "home"]);
});

test("P3: a leading # on the filter is ignored", () => {
  const file = seeded();
  assert.deepEqual(titles(notes(file, "list", "--tag", "#work").out).sort(), ["Plan", "Standup"]);
  assert.equal(notes(file, "count", "--tag", "#network").out, "1\n");
  assert.equal(notes(file, "rm", "--tag", "#network").out, "removed 1 note\n");
});

test("P3: an empty filter is an error and removes nothing", () => {
  const file = seeded();
  for (const filter of ["", "#", "  "]) {
    const removed = notes(file, "rm", "--tag", filter);
    assert.equal(removed.code, 1, `rm --tag ${JSON.stringify(filter)}`);
    assert.equal(removed.err, "a tag filter needs a tag\n");
    assert.equal(removed.out, "");
  }
  assert.equal(notes(file, "count").out, "5\n");
  assert.equal(notes(file, "list", "--tag", "#").code, 1);
});

test("an empty store lists and counts nothing for a tag", () => {
  const file = fresh();
  assert.equal(notes(file, "list", "--tag", "work").out, "No notes.\n");
  assert.equal(notes(file, "count", "--tag", "work").out, "0\n");
  assert.equal(notes(file, "rm", "--tag", "work").out, "removed 0 notes\n");
});

test("a repeated removal finds nothing the second time", () => {
  const file = seeded();
  assert.equal(notes(file, "rm", "--tag", "work").out, "removed 2 notes\n");
  assert.equal(notes(file, "rm", "--tag", "work").out, "removed 0 notes\n");
  assert.equal(notes(file, "count").out, "3\n");
});

test("after an error the notes are as they were", () => {
  const file = seeded();
  const before = readFileSync(file, "utf8");
  assert.equal(notes(file, "rm", "--tag").code, 1);
  assert.equal(notes(file, "show", "99").code, 1);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(notes(file, "count", "--tag", "work").out, "2\n");
});

test("id removal and tags listing still work", () => {
  const file = seeded();
  assert.equal(notes(file, "rm", "3").out, "removed #3\n");
  assert.equal(notes(file, "tags").code, 0);
});
