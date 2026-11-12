import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "notes.js");
const TODAY = "2026-03-10";

function scratch() {
  return join(mkdtempSync(join(tmpdir(), "notes-hidden-")), "notes.json");
}

function notes(file, ...argv) {
  const result = spawnSync(process.execPath, [BIN, ...argv], { env: { ...process.env, NOTES_FILE: file, NOTES_TODAY: TODAY }, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const stored = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Notes 1-8 in one file: overdue by nine days and by one, due today, within the week, on the week's edge, past it, no due date, done. */
function busy() {
  const file = scratch();
  notes(file, "add", "Pay rent", "--tag", "home", "--due", "2026-03-01");
  notes(file, "add", "Call Sam", "--due", "2026-03-09");
  notes(file, "add", "Send invoice", "--tag", "work", "--due", "2026-03-10");
  notes(file, "add", "Book flights", "--due", "2026-03-12");
  notes(file, "add", "Renew passport", "--tag", "home", "--due", "2026-03-17");
  notes(file, "add", "Plan trip", "--due", "2026-03-18");
  notes(file, "add", "Someday");
  notes(file, "add", "Old chore", "--due", "2026-03-02");
  notes(file, "done", "8");
  return file;
}

test("P1: a due date is a real YYYY-MM-DD day; anything else is an error and writes nothing", () => {
  const file = scratch();
  notes(file, "add", "Keep");
  const before = readFileSync(file, "utf8");
  ["2026-02-30", "2026-13-01", "10/03/2026", "2026-3-1", "soon", ""].forEach((value) => {
    const added = notes(file, "add", "Bad", "--due", value);
    assert.equal(added.code, 1, JSON.stringify(value));
    assert.equal(added.err, "a due date must be YYYY-MM-DD\n");
    const edited = notes(file, "edit", "1", "--due", value);
    assert.equal(edited.code, 1, JSON.stringify(value));
    assert.equal(edited.err, "a due date must be YYYY-MM-DD\n");
  });
  assert.equal(readFileSync(file, "utf8"), before);
});

test("P1: --due none clears a due date on edit, and means no due date on add", () => {
  const file = scratch();
  notes(file, "add", "Pay rent", "--due", "2026-03-12");
  assert.equal(stored(file).notes[0].due, "2026-03-12");
  assert.equal(notes(file, "edit", "1", "--due", "none").out, "edited #1\n");
  assert.equal("due" in stored(file).notes[0], false);
  assert.equal(notes(file, "add", "Other", "--due", "none").out, "added #2\n");
  assert.equal(stored(file).notes[1].title, "Other");
  assert.equal("due" in stored(file).notes[1], false);
});

test("P2: today and tomorrow are stored as the dates they mean", () => {
  const file = scratch();
  notes(file, "add", "A", "--due", "today");
  notes(file, "add", "B", "--due", "tomorrow");
  assert.deepEqual(stored(file).notes.map((entry) => entry.due), ["2026-03-10", "2026-03-11"]);
  notes(file, "edit", "1", "--due", "tomorrow");
  assert.equal(stored(file).notes[0].due, "2026-03-11");
});

test("list ends its lines with the due date and the done mark, after the tags, and shows done notes", () => {
  const file = scratch();
  notes(file, "add", "Buy milk", "--tag", "home", "--due", "2026-03-12");
  notes(file, "add", "Plain");
  notes(file, "add", "Call", "--due", "2026-03-11");
  notes(file, "done", "1");
  notes(file, "done", "2");
  assert.equal(notes(file, "list").out, "#1  Buy milk  [home]  due 2026-03-12  done\n#2  Plain  done\n#3  Call  due 2026-03-11\n");
});

test("show prints due after the tags and done after updated, only when they are set", () => {
  const file = scratch();
  notes(file, "add", "Buy milk", "--tag", "home", "--due", "2026-03-12");
  notes(file, "add", "Plain");
  notes(file, "add", "No tags", "--due", "2026-03-15");
  notes(file, "done", "1");
  const lines = notes(file, "show", "1").out.split("\n");
  assert.equal(lines[0], "#1 Buy milk");
  assert.equal(lines[1], "tags: home");
  assert.equal(lines[2], "due: 2026-03-12");
  assert.match(lines[3], /^created: /);
  assert.match(lines[4], /^updated: /);
  assert.equal(lines[5], "done: 2026-03-10");
  assert.doesNotMatch(notes(file, "show", "2").out, /^(due|done):/m);
  assert.equal(notes(file, "show", "3").out.split("\n")[1], "due: 2026-03-15");
});

test("the data file keeps due and done as strings, with no key for a note without one", () => {
  const file = scratch();
  notes(file, "add", "A", "--due", "2026-03-12");
  notes(file, "add", "B");
  notes(file, "done", "1");
  const [first, second] = stored(file).notes;
  assert.equal(first.due, "2026-03-12");
  assert.equal(first.done, "2026-03-10");
  assert.equal("due" in second, false);
  assert.equal("done" in second, false);
});

test("P3: done stores today; done twice keeps the first date and says so; undone removes it", () => {
  const file = scratch();
  notes(file, "add", "A");
  assert.equal(notes(file, "done", "1").out, "done #1\n");
  const again = spawnSync(process.execPath, [BIN, "done", "1"], { env: { ...process.env, NOTES_FILE: file, NOTES_TODAY: "2026-03-20" }, encoding: "utf8" });
  assert.equal(again.status, 0);
  assert.equal(again.stdout, "#1 is already done\n");
  assert.equal(stored(file).notes[0].done, "2026-03-10");
  assert.equal(notes(file, "undone", "1").out, "undone #1\n");
  assert.equal("done" in stored(file).notes[0], false);
  const notDone = notes(file, "undone", "1");
  assert.equal(notDone.code, 0);
  assert.equal(notDone.out, "#1 is not done\n");
});

test("P3: a done note can be edited, and editing keeps its due and done dates", () => {
  const file = scratch();
  notes(file, "add", "A", "--due", "2026-03-12");
  notes(file, "done", "1");
  assert.equal(notes(file, "edit", "1", "--title", "B").out, "edited #1\n");
  assert.equal(notes(file, "edit", "1", "--due", "2026-03-20").out, "edited #1\n");
  const note = stored(file).notes[0];
  assert.deepEqual([note.title, note.due, note.done], ["B", "2026-03-20", "2026-03-10"]);
});

test("done and undone of a missing note are errors that write nothing", () => {
  const file = scratch();
  notes(file, "add", "A");
  const before = readFileSync(file, "utf8");
  assert.deepEqual([notes(file, "done", "9").code, notes(file, "done", "9").err], [1, "no note 9\n"]);
  assert.deepEqual([notes(file, "undone", "9").code, notes(file, "undone", "9").err], [1, "no note 9\n"]);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("P4 and P5: the agenda's groups, headings, order, indent, blank lines and the late notes", () => {
  const file = busy();
  assert.equal(
    notes(file, "agenda").out,
    [
      "Overdue (2)",
      "  #1  Pay rent  [home]  due 2026-03-01  (9 days late)",
      "  #2  Call Sam  due 2026-03-09  (1 day late)",
      "",
      "Today (1)",
      "  #3  Send invoice  [work]  due 2026-03-10",
      "",
      "Next 7 days (2)",
      "  #4  Book flights  due 2026-03-12",
      "  #5  Renew passport  [home]  due 2026-03-17",
      "",
      "Later (1)",
      "  #6  Plan trip  due 2026-03-18",
      "",
    ].join("\n"),
  );
});

test("P4: a group with no notes is left out, notes with the same date go by id, and a note's order is by date first", () => {
  const file = scratch();
  notes(file, "add", "Later one", "--due", "2026-04-01");
  notes(file, "add", "Second", "--due", "2026-03-11");
  notes(file, "add", "First", "--due", "2026-03-11");
  notes(file, "add", "Sooner", "--due", "2026-03-10");
  assert.equal(notes(file, "agenda").out, "Today (1)\n  #4  Sooner  due 2026-03-10\n\nNext 7 days (2)\n  #2  Second  due 2026-03-11\n  #3  First  due 2026-03-11\n\nLater (1)\n  #1  Later one  due 2026-04-01\n");
});

test("P5: only the overdue group says how late", () => {
  const out = notes(busy(), "agenda").out;
  assert.equal((out.match(/late\)/g) ?? []).length, 2);
});

test("P4: with nothing to show the agenda says so and exits 0", () => {
  const file = scratch();
  assert.deepEqual([notes(file, "agenda").code, notes(file, "agenda").out], [0, "Nothing due.\n"]);
  notes(file, "add", "Undated");
  notes(file, "add", "Finished", "--due", "2026-03-12");
  notes(file, "done", "2");
  assert.equal(notes(file, "agenda").out, "Nothing due.\n");
});

test("P6: the agenda leaves out done notes and undated notes, and a done note is back after undone", () => {
  const file = busy();
  const out = notes(file, "agenda").out;
  assert.doesNotMatch(out, /Old chore|Someday/);
  notes(file, "undone", "8");
  assert.match(notes(file, "agenda").out, /#8  Old chore  due 2026-03-02  \(8 days late\)/);
});

test("P6: agenda --tag narrows to whole-tag matches, as list does", () => {
  const file = busy();
  assert.equal(notes(file, "agenda", "--tag", "home").out, "Overdue (1)\n  #1  Pay rent  [home]  due 2026-03-01  (9 days late)\n\nNext 7 days (1)\n  #5  Renew passport  [home]  due 2026-03-17\n");
  assert.equal(notes(file, "agenda", "--tag", "hom").out, "Nothing due.\n");
});

test("P7: agenda, list and show never write the data file, and an old file without due or done works", () => {
  const file = scratch();
  writeFileSync(file, `${JSON.stringify({ nextId: 2, notes: [{ id: 1, title: "Old", body: "", tags: ["x"], created: "2026-01-01T10:00:00.000Z", updated: "2026-01-01T10:00:00.000Z" }] })}\n`);
  const before = readFileSync(file, "utf8");
  assert.equal(notes(file, "list").out, "#1  Old  [x]\n");
  assert.equal(notes(file, "agenda").out, "Nothing due.\n");
  assert.match(notes(file, "show", "1").out, /^#1 Old\ntags: x\ncreated: /);
  busy();
  assert.equal(readFileSync(file, "utf8"), before);
  const other = busy();
  const snapshot = readFileSync(other, "utf8");
  notes(other, "agenda");
  notes(other, "list");
  notes(other, "show", "1");
  assert.equal(readFileSync(other, "utf8"), snapshot);
});
