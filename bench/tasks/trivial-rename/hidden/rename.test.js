import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "notes.js");

function scratch() {
  return join(mkdtempSync(join(tmpdir(), "notes-hidden-")), "notes.json");
}

function notes(file, ...argv) {
  const result = spawnSync(process.execPath, [BIN, ...argv], { env: { ...process.env, NOTES_FILE: file }, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test("delete removes a note and prints what rm printed", () => {
  const file = scratch();
  notes(file, "add", "Buy milk");
  notes(file, "add", "Call Sam");
  const result = notes(file, "delete", "1");
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out, "removed #1\n");
  assert.equal(notes(file, "list").out, "#2  Call Sam\n");
});

test("delete of a missing note is the old error", () => {
  const file = scratch();
  const result = notes(file, "delete", "7");
  assert.equal(result.code, 1);
  assert.equal(result.err, "no note 7\n");
});

test("rm is gone: it is an unknown command and removes nothing", () => {
  const file = scratch();
  notes(file, "add", "Keep me");
  const result = notes(file, "rm", "1");
  assert.equal(result.code, 1);
  assert.match(result.err, /^usage: notes <command>/);
  assert.equal(notes(file, "list").out, "#1  Keep me\n");
});

test("the help names delete and not rm", () => {
  const help = notes(scratch(), "help").out;
  assert.match(help, /^\s+delete <id>\s+remove a note$/m);
  assert.doesNotMatch(help, /^\s+rm\b/m);
});

test("the README shows delete and not rm", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /notes\.js delete 1/);
  assert.doesNotMatch(readme, /notes\.js rm\b/);
});

test("nothing else changed: the other commands print as before", () => {
  const file = scratch();
  assert.equal(notes(file, "add", "A", "--tag", "x").out, "added #1\n");
  assert.equal(notes(file, "edit", "1", "--title", "B").out, "edited #1\n");
  assert.equal(notes(file, "list", "--tag", "x").out, "#1  B  [x]\n");
  assert.ok(existsSync(file));
});
