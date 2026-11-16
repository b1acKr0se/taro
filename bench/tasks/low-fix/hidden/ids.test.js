import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "notes.js");

function scratch() {
  return join(mkdtempSync(join(tmpdir(), "notes-hidden-")), "notes.json");
}

function notes(file, ...argv) {
  const result = spawnSync(process.execPath, [BIN, ...argv], { env: { ...process.env, NOTES_FILE: file }, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const NOT_IDS = ["0x1", "1e0", "1.0", "+1", " 1", ""];

test("show says there is no such note for anything that is not digits", () => {
  const file = scratch();
  notes(file, "add", "Buy milk");
  NOT_IDS.forEach((id) => {
    const result = notes(file, "show", id);
    assert.equal(result.code, 1, JSON.stringify(id));
    assert.equal(result.out, "", JSON.stringify(id));
    assert.equal(result.err, `no note ${id}\n`);
  });
});

test("edit and rm take ids the same way, and a failed rm leaves the file as it was", () => {
  const file = scratch();
  notes(file, "add", "Buy milk");
  const before = readFileSync(file, "utf8");
  NOT_IDS.forEach((id) => {
    assert.equal(notes(file, "edit", id, "--title", "Changed").code, 1, id);
    const removed = notes(file, "rm", id);
    assert.equal(removed.code, 1, id);
    assert.equal(removed.err, `no note ${id}\n`);
  });
  assert.equal(readFileSync(file, "utf8"), before);
});

test("plain ids still work, with or without leading zeros", () => {
  const file = scratch();
  notes(file, "add", "Buy milk");
  assert.match(notes(file, "show", "1").out, /^#1 Buy milk\n/);
  assert.match(notes(file, "show", "01").out, /^#1 Buy milk\n/);
  assert.equal(notes(file, "edit", "01", "--title", "Buy oat milk").out, "edited #1\n");
  assert.equal(notes(file, "rm", "1").out, "removed #1\n");
});

test("a missing id says what it always said", () => {
  const file = scratch();
  assert.equal(notes(file, "show", "9").err, "no note 9\n");
});
