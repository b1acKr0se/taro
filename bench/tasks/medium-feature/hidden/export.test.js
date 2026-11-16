import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "notes.js");

function scratch() {
  const folder = mkdtempSync(join(tmpdir(), "notes-hidden-"));
  return { folder, file: join(folder, "data", "notes.json"), vault: join(folder, "vault") };
}

function notes(file, ...argv) {
  const result = spawnSync(process.execPath, [BIN, ...argv], { env: { ...process.env, NOTES_FILE: file }, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function frontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  assert.ok(match, `no front matter in ${JSON.stringify(text.slice(0, 80))}`);
  const fields = {};
  const order = [];
  match[1].split("\n").forEach((line) => {
    const at = line.indexOf(":");
    fields[line.slice(0, at)] = line.slice(at + 1).trim();
    order.push(line.slice(0, at));
  });
  return { fields, order, rest: text.slice(match[0].length) };
}

const files = (folder) => readdirSync(folder).sort();

test("writes one file per note with front matter in the stated order, then the body", () => {
  const { file, vault } = scratch();
  notes(file, "add", "Buy milk", "--body", "2 litres", "--tag", "home", "--tag", "errands");
  notes(file, "add", "Call Sam");
  const result = notes(file, "export", vault);
  assert.equal(result.code, 0, result.err);
  assert.equal(result.out, `exported 2 notes to ${vault}\n`);
  assert.deepEqual(files(vault), ["buy-milk.md", "call-sam.md"]);
  const milk = frontMatter(readFileSync(join(vault, "buy-milk.md"), "utf8"));
  assert.deepEqual(milk.order, ["id", "title", "tags", "created", "updated"]);
  assert.equal(milk.fields.id, "1");
  assert.match(milk.fields.created, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(milk.rest, "\n2 litres\n");
  const sam = readFileSync(join(vault, "call-sam.md"), "utf8");
  assert.ok(sam.trimEnd().endsWith("---"), "a note with no body is just the front matter");
});

test("says exported 1 note for one", () => {
  const { file, vault } = scratch();
  notes(file, "add", "Only");
  assert.equal(notes(file, "export", vault).out, `exported 1 note to ${vault}\n`);
});

test("P1: file names are slugs of the title; same slug gets -2, -3 in id order; no letters means note-<id>", () => {
  const { file, vault } = scratch();
  ["Buy milk!", "buy   MILK", "Buy-milk", "!!!", "Plan 2026"].forEach((title) => notes(file, "add", title));
  assert.equal(notes(file, "export", vault).code, 0);
  assert.deepEqual(files(vault), ["buy-milk-2.md", "buy-milk-3.md", "buy-milk.md", "note-4.md", "plan-2026.md"]);
  assert.match(readFileSync(join(vault, "buy-milk-2.md"), "utf8"), /^---\nid: 2\n/);
});

test("P1: a very long title gives a file name of at most 80 characters, slug cut to 60", () => {
  const { file, vault } = scratch();
  notes(file, "add", `${"word ".repeat(80)}end`);
  assert.equal(notes(file, "export", vault).code, 0);
  const [name] = files(vault);
  assert.ok(name.length <= 80, name);
  assert.match(name, /^word-word-[a-z0-9-]+\.md$/);
});

test("P2: titles are JSON strings and tags a JSON array on one line", () => {
  const { file, vault } = scratch();
  notes(file, "add", 'Re: "plan" #1', "--tag", "home", "--tag", "errands");
  notes(file, "add", "Plain");
  assert.equal(notes(file, "export", vault).code, 0);
  const first = frontMatter(readFileSync(join(vault, "re-plan-1.md"), "utf8"));
  assert.equal(JSON.parse(first.fields.title), 'Re: "plan" #1');
  assert.deepEqual(JSON.parse(first.fields.tags), ["home", "errands"]);
  const plain = frontMatter(readFileSync(join(vault, "plain.md"), "utf8"));
  assert.equal(plain.fields.tags, "[]");
});

test("P3: running it twice gives the same files, rewritten, never -2 for a note's own file", () => {
  const { file, vault } = scratch();
  notes(file, "add", "Same");
  notes(file, "add", "Other");
  notes(file, "export", vault);
  const before = readFileSync(join(vault, "same.md"), "utf8");
  const second = notes(file, "export", vault);
  assert.equal(second.code, 0);
  assert.deepEqual(files(vault), ["other.md", "same.md"]);
  assert.equal(readFileSync(join(vault, "same.md"), "utf8"), before);
});

test("P3: an edit shows up on the next export, and the earlier files are not deleted", () => {
  const { file, vault } = scratch();
  notes(file, "add", "Draft", "--body", "one");
  notes(file, "export", vault);
  notes(file, "edit", "1", "--body", "two");
  notes(file, "export", vault);
  assert.match(readFileSync(join(vault, "draft.md"), "utf8"), /\n\ntwo\n$/);
  notes(file, "rm", "1");
  notes(file, "add", "New");
  notes(file, "export", vault);
  assert.deepEqual(files(vault), ["draft.md", "new.md"]);
});

test("P3: files it did not write stay as they were", () => {
  const { file, vault } = scratch();
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, "readme.txt"), "mine");
  writeFileSync(join(vault, "keep.md"), "hand written");
  notes(file, "add", "Another");
  const result = notes(file, "export", vault);
  assert.equal(result.code, 0, result.err);
  assert.equal(readFileSync(join(vault, "readme.txt"), "utf8"), "mine");
  assert.equal(files(vault).includes("readme.txt"), true);
  assert.equal(readFileSync(join(vault, "keep.md"), "utf8"), "hand written");
  assert.ok(files(vault).length === 3, files(vault).join(","));
});

test("an empty store says so, exits 0 and creates no folder", () => {
  const { file, vault } = scratch();
  const result = notes(file, "export", vault);
  assert.deepEqual([result.code, result.out], [0, "No notes to export.\n"]);
  assert.equal(existsSync(vault), false);
});

test("creates the folder and its parents", () => {
  const { file, folder } = scratch();
  notes(file, "add", "x");
  const deep = join(folder, "a", "b", "c");
  assert.equal(notes(file, "export", deep).code, 0);
  assert.deepEqual(files(deep), ["x.md"]);
});

test("after an error the data file is as it was and the next export works", () => {
  const { file, folder, vault } = scratch();
  notes(file, "add", "x");
  const data = readFileSync(file, "utf8");
  const blocker = join(folder, "blocker");
  writeFileSync(blocker, "a file, not a folder");
  const failed = notes(file, "export", blocker);
  assert.equal(failed.code, 1);
  assert.notEqual(failed.err.trim(), "");
  assert.equal(readFileSync(file, "utf8"), data);
  assert.equal(notes(file, "export", vault).code, 0);
  assert.deepEqual(files(vault), ["x.md"]);
});

test("export without a folder is an error", () => {
  const { file } = scratch();
  notes(file, "add", "x");
  const result = notes(file, "export");
  assert.equal(result.code, 1);
  assert.notEqual(result.err.trim(), "");
});

test("the existing commands still work", () => {
  const { file } = scratch();
  assert.equal(notes(file, "add", "x").out, "added #1\n");
  assert.equal(notes(file, "list").out, "#1  x\n");
});
