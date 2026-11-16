import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "notes.js");

const note = (id, title, extra = {}) => ({ id, title, body: "", tags: [], created: `2026-01-0${id}T10:00:00.000Z`, updated: `2026-01-0${id}T10:00:00.000Z`, ...extra });

function folder() {
  return mkdtempSync(join(tmpdir(), "notes-hidden-"));
}

function write(path, nextId, notes) {
  writeFileSync(path, `${JSON.stringify({ nextId, notes }, null, 2)}\n`);
  return path;
}

function notes(file, ...argv) {
  const result = spawnSync(process.execPath, [BIN, ...argv], { env: { ...process.env, NOTES_FILE: file }, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const stored = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Laptop: #1 Buy milk, #2 Call Sam (next 3). Desktop: #1 Buy milk (the same note), #2 Pay rent, #3 Book flights (next 4). */
function laptopAndDesktop() {
  const directory = folder();
  const laptop = write(join(directory, "laptop.json"), 3, [note(1, "Buy milk"), note(2, "Call Sam")]);
  const desktop = write(join(directory, "desktop.json"), 4, [note(1, "Buy milk"), note(2, "Pay rent", { body: "by Friday", tags: ["home"] }), note(3, "Book flights")]);
  return { laptop, desktop, directory };
}

test("my notes keep their numbers and nothing is lost", () => {
  const { laptop, desktop } = laptopAndDesktop();
  const result = notes(laptop, "merge", desktop);
  assert.equal(result.code, 0, result.err);
  const { notes: merged } = stored(laptop);
  assert.deepEqual(merged.filter((entry) => entry.id <= 2).map((entry) => [entry.id, entry.title]), [[1, "Buy milk"], [2, "Call Sam"]]);
  assert.deepEqual(merged.map((entry) => entry.title).sort(), ["Book flights", "Buy milk", "Call Sam", "Pay rent"]);
});

test("a clashing incoming note gets a new number beyond everything either file used; a free number is kept", () => {
  const { laptop, desktop } = laptopAndDesktop();
  notes(laptop, "merge", desktop);
  const byTitle = Object.fromEntries(stored(laptop).notes.map((entry) => [entry.title, entry.id]));
  assert.equal(byTitle["Pay rent"], 4);
  assert.equal(byTitle["Book flights"], 3);
  assert.equal(stored(laptop).nextId, 5);
});

test("it prints each renumbering and the totals", () => {
  const { laptop, desktop } = laptopAndDesktop();
  const result = notes(laptop, "merge", desktop);
  assert.equal(result.out, "#2 -> #4  Pay rent\nmerged 2 notes, 1 already there\n");
});

test("the merged notes keep their content", () => {
  const { laptop, desktop } = laptopAndDesktop();
  notes(laptop, "merge", desktop);
  const rent = stored(laptop).notes.find((entry) => entry.title === "Pay rent");
  assert.equal(rent.body, "by Friday");
  assert.deepEqual(rent.tags, ["home"]);
  assert.equal(rent.created, "2026-01-02T10:00:00.000Z");
  assert.match(notes(laptop, "show", "4").out, /^#4 Pay rent\ntags: home\n/);
});

test("renumbered notes take new numbers in the incoming number order, never one already given", () => {
  const directory = folder();
  const mine = write(join(directory, "mine.json"), 3, [note(1, "A"), note(2, "B")]);
  const theirs = write(join(directory, "theirs.json"), 5, [note(2, "X"), note(1, "Y"), note(4, "Z")]);
  const result = notes(mine, "merge", theirs);
  assert.equal(result.out, "#1 -> #5  Y\n#2 -> #6  X\nmerged 3 notes, 0 already there\n");
  const ids = stored(mine).notes.map((entry) => entry.id).sort((left, right) => left - right);
  assert.deepEqual(ids, [1, 2, 4, 5, 6]);
  assert.equal(stored(mine).nextId, 7);
});

test("a note already there is not added twice, whatever number the other file gave it", () => {
  const directory = folder();
  const mine = write(join(directory, "mine.json"), 3, [note(1, "Buy milk"), note(2, "Call Sam")]);
  const theirs = write(join(directory, "theirs.json"), 8, [{ ...note(1, "Buy milk"), id: 7 }]);
  const result = notes(mine, "merge", theirs);
  assert.equal(result.out, "merged 0 notes, 1 already there\n");
  assert.equal(stored(mine).notes.length, 2);
});

test("a note with the same title but other content is a different note", () => {
  const directory = folder();
  const mine = write(join(directory, "mine.json"), 2, [note(1, "Buy milk")]);
  const theirs = write(join(directory, "theirs.json"), 2, [note(1, "Buy milk", { body: "oat" })]);
  assert.equal(notes(mine, "merge", theirs).out, "#1 -> #2  Buy milk\nmerged 1 note, 0 already there\n");
  assert.equal(stored(mine).notes.length, 2);
});

test("when nothing is added my file is not rewritten", () => {
  const { laptop, directory } = laptopAndDesktop();
  const before = readFileSync(laptop, "utf8");
  const same = write(join(directory, "same.json"), 3, [note(1, "Buy milk"), note(2, "Call Sam")]);
  assert.equal(notes(laptop, "merge", same).out, "merged 0 notes, 2 already there\n");
  assert.equal(notes(laptop, "merge", laptop).out, "merged 0 notes, 2 already there\n");
  assert.equal(readFileSync(laptop, "utf8"), before);
});

test("an empty other file adds nothing", () => {
  const { laptop, directory } = laptopAndDesktop();
  const empty = write(join(directory, "empty.json"), 1, []);
  assert.equal(notes(laptop, "merge", empty).out, "merged 0 notes, 0 already there\n");
});

test("errors exit 1 with the reason and leave my file as it was", () => {
  const { laptop, directory } = laptopAndDesktop();
  const before = readFileSync(laptop, "utf8");
  const bad = join(directory, "bad.json");
  writeFileSync(bad, "{ nope");
  const other = join(directory, "other.json");
  writeFileSync(other, JSON.stringify({ hello: 1 }));
  const missing = join(directory, "missing.json");
  assert.deepEqual([notes(laptop, "merge").code, notes(laptop, "merge").err], [1, "merge needs a file\n"]);
  assert.deepEqual([notes(laptop, "merge", missing).code, notes(laptop, "merge", missing).err], [1, `no notes file at ${missing}\n`]);
  assert.equal(notes(laptop, "merge", bad).code, 1);
  assert.match(notes(laptop, "merge", bad).err, new RegExp(`^${bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not valid JSON \\(`));
  assert.equal(notes(laptop, "merge", other).err, `${other} is not a notes file\n`);
  assert.equal(readFileSync(laptop, "utf8"), before);
});

test("the other file is left alone, and the existing commands still work on the merged file", () => {
  const { laptop, desktop } = laptopAndDesktop();
  const theirs = readFileSync(desktop, "utf8");
  notes(laptop, "merge", desktop);
  assert.equal(readFileSync(desktop, "utf8"), theirs);
  assert.equal(notes(laptop, "add", "Next").out, "added #5\n");
  assert.equal(notes(laptop, "list").out.trim().split("\n").length, 5);
});
