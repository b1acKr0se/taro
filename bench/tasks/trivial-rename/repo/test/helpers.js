import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../src/cli.js";

/** A fresh data file path in its own temporary folder. */
export function freshFile() {
  return join(mkdtempSync(join(tmpdir(), "notes-test-")), "notes.json");
}

/** Runs a command line against a data file; returns `{ code, out, err }`. */
export function notes(file, ...argv) {
  const previous = process.env.NOTES_FILE;
  process.env.NOTES_FILE = file;
  let out = "";
  let err = "";
  try {
    const code = run(argv, { out: (text) => (out += text), err: (text) => (err += text) });
    return { code, out, err };
  } finally {
    if (previous === undefined) delete process.env.NOTES_FILE;
    else process.env.NOTES_FILE = previous;
  }
}
