import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDate, formatList, formatNote } from "../src/format.js";

const NOTE = { id: 3, title: "Buy milk", body: "2 litres", tags: ["home", "errands"], created: "2026-01-05T10:00:00.000Z", updated: "2026-01-06T11:30:00.000Z" };

test("formats a date to the minute", () => {
  assert.equal(formatDate(NOTE.created), "2026-01-05 10:00");
});

test("an empty list says so", () => {
  assert.equal(formatList([]), "No notes.\n");
});

test("a list has a line per note, with tags when there are some", () => {
  assert.equal(formatList([NOTE, { ...NOTE, id: 4, title: "Call Sam", tags: [] }]), "#3  Buy milk  [home, errands]\n#4  Call Sam\n");
});

test("a note shows tags, dates and body", () => {
  assert.equal(formatNote(NOTE), "#3 Buy milk\ntags: home, errands\ncreated: 2026-01-05 10:00\nupdated: 2026-01-06 11:30\n\n2 litres\n");
});

test("a note without tags or body leaves those out", () => {
  assert.equal(formatNote({ ...NOTE, tags: [], body: "" }), "#3 Buy milk\ncreated: 2026-01-05 10:00\nupdated: 2026-01-06 11:30\n");
});
