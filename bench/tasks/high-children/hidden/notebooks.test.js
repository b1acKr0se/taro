import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "notes.js");

const fresh = () => join(mkdtempSync(join(tmpdir(), "notes-hidden-")), "notes.json");

function notes(file, ...argv) {
  const result = spawnSync(process.execPath, [BIN, ...argv], { env: { ...process.env, NOTES_FILE: file }, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function seeded() {
  const file = fresh();
  notes(file, "add", "Standup notes", "--body", "daily sync with the team", "--tag", "work", "--notebook", "Work");
  notes(file, "add", "Team lunch", "--body", "pick a place", "--notebook", "work");
  notes(file, "add", "Buy milk", "--body", "for the team party", "--tag", "home", "--notebook", "  Home  ");
  notes(file, "add", "Side idea", "--notebook", "Side Project");
  notes(file, "add", "Loose thought");
  return file;
}

test("a note without a notebook is in inbox; names are trimmed, lowercased, spaces become a hyphen", () => {
  const file = seeded();
  assert.equal(notes(file, "list").out, [
    "#1  Standup notes  [work]  @work",
    "#2  Team lunch  @work",
    "#3  Buy milk  [home]  @home",
    "#4  Side idea  @side-project",
    "#5  Loose thought  @inbox",
    "",
  ].join("\n"));
  assert.match(notes(file, "show", "4").out, /^#4 Side idea\nnotebook: side-project\n/);
});

test("list --notebook filters, with a normalised name, and combines with --tag", () => {
  const file = seeded();
  assert.equal(notes(file, "list", "--notebook", "WORK").out, "#1  Standup notes  [work]  @work\n#2  Team lunch  @work\n");
  assert.equal(notes(file, "list", "--notebook", "work", "--tag", "work").out, "#1  Standup notes  [work]  @work\n");
  assert.equal(notes(file, "list", "--notebook", "side project").out, "#4  Side idea  @side-project\n");
  assert.equal(notes(file, "list", "--notebook", "nothing").out, "No notes.\n");
});

test("edit moves a note to another notebook", () => {
  const file = seeded();
  assert.equal(notes(file, "edit", "5", "--notebook", "Home").code, 0);
  assert.match(notes(file, "show", "5").out, /notebook: home/);
  assert.equal(notes(file, "notebooks").out, "home  2\nside-project  1\nwork  2\n");
});

test("P1: an empty notebook name is an error and writes nothing", () => {
  const file = seeded();
  const before = readFileSync(file, "utf8");
  for (const argv of [["add", "x", "--notebook", "   "], ["edit", "1", "--notebook", ""], ["list", "--notebook", " "], ["search", "team", "--notebook", ""]]) {
    const result = notes(file, ...argv);
    assert.equal(result.code, 1, argv.join(" "));
    assert.equal(result.err, "a notebook needs a name\n", argv.join(" "));
  }
  assert.equal(readFileSync(file, "utf8"), before);
});

test("notebooks lists the non-empty ones alphabetically; none when there are no notes", () => {
  assert.equal(notes(seeded(), "notebooks").out, "home  1\ninbox  1\nside-project  1\nwork  2\n");
  assert.equal(notes(fresh(), "notebooks").out, "No notebooks.\n");
});

test("existing data files without notebooks read as inbox and are not rewritten by reading", () => {
  const file = fresh();
  const legacy = { nextId: 3, notes: [
    { id: 1, title: "Old one", body: "", tags: [], created: "2026-01-05T10:00:00.000Z", updated: "2026-01-05T10:00:00.000Z" },
    { id: 2, title: "Old two", body: "x", tags: ["a"], created: "2026-01-05T10:00:00.000Z", updated: "2026-01-05T10:00:00.000Z" },
  ] };
  writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`);
  const before = readFileSync(file, "utf8");
  assert.equal(notes(file, "list").out, "#1  Old one  @inbox\n#2  Old two  [a]  @inbox\n");
  assert.equal(notes(file, "notebooks").out, "inbox  2\n");
  assert.equal(notes(file, "summary").code, 0);
  assert.equal(notes(file, "search", "old").code, 0);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(notes(file, "add", "New").code, 0);
  assert.equal(notes(file, "list", "--notebook", "inbox").out, "#1  Old one  @inbox\n#2  Old two  [a]  @inbox\n#3  New  @inbox\n");
});

test("search finds notes by title, body or tags, all words in any order, case-insensitive", () => {
  const file = seeded();
  assert.equal(notes(file, "search", "TEAM").out, "#2  Team lunch  @work\n#1  Standup notes  [work]  @work\n#3  Buy milk  [home]  @home\n");
  assert.equal(notes(file, "search", "sync", "daily").out, "#1  Standup notes  [work]  @work\n");
  assert.equal(notes(file, "search", "home").out, "#3  Buy milk  [home]  @home\n");
  assert.equal(notes(file, "search", "nomatch").out, "No matching notes.\n");
});

test("P2: notes whose title holds every word come first, then the rest, each by id", () => {
  const file = fresh();
  notes(file, "add", "Plan", "--body", "the budget plan");
  notes(file, "add", "Budget plan", "--body", "x");
  notes(file, "add", "Other", "--body", "budget and plan");
  notes(file, "add", "Plan budget review");
  assert.equal(notes(file, "search", "plan", "budget").out, [
    "#2  Budget plan  @inbox",
    "#4  Plan budget review  @inbox",
    "#1  Plan  @inbox",
    "#3  Other  @inbox",
    "",
  ].join("\n"));
});

test("search narrows by --notebook and --tag", () => {
  const file = seeded();
  assert.equal(notes(file, "search", "team", "--notebook", "work").out, "#2  Team lunch  @work\n#1  Standup notes  [work]  @work\n");
  assert.equal(notes(file, "search", "team", "--notebook", "Home", "--tag", "HOME").out, "#3  Buy milk  [home]  @home\n");
  assert.equal(notes(file, "search", "team", "--tag", "lunch").out, "No matching notes.\n");
});

test("search with no words is an error", () => {
  const file = seeded();
  const result = notes(file, "search");
  assert.deepEqual([result.code, result.out, result.err], [1, "", "search needs words\n"]);
  assert.equal(notes(file, "search", "--notebook", "work").code, 1);
});

test("P3: the summary's layout, singular forms and empty case", () => {
  assert.equal(notes(seeded(), "summary").out, "5 notes in 4 notebooks\n  work  2\n  home  1\n  inbox  1\n  side-project  1\n");
  const one = fresh();
  notes(one, "add", "Only");
  assert.equal(notes(one, "summary").out, "1 note in 1 notebook\n  inbox  1\n");
  assert.equal(notes(fresh(), "summary").out, "No notes.\n");
});

test("the summary follows removals and moves", () => {
  const file = seeded();
  notes(file, "rm", "4");
  notes(file, "edit", "5", "--notebook", "work");
  assert.equal(notes(file, "summary").out, "4 notes in 2 notebooks\n  work  3\n  home  1\n");
});

test("an error leaves the data file as it was, and the next command works", () => {
  const file = seeded();
  const before = readFileSync(file, "utf8");
  assert.equal(notes(file, "edit", "99", "--notebook", "x").code, 1);
  assert.equal(notes(file, "search").code, 1);
  assert.equal(readFileSync(file, "utf8"), before);
  assert.equal(notes(file, "notebooks").code, 0);
});

test("the earlier commands still work", () => {
  const file = fresh();
  assert.equal(notes(file, "add", "x", "--tag", "a").out, "added #1\n");
  assert.equal(notes(file, "rm", "1").out, "removed #1\n");
});
