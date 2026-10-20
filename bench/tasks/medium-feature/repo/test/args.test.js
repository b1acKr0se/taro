import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs } from "../src/args.js";

test("splits a command, positionals and flags", () => {
  assert.deepEqual(parseArgs(["add", "Buy", "milk", "--body", "2 litres"]), { command: "add", positionals: ["Buy", "milk"], flags: { body: "2 litres" } });
});

test("accepts --name=value", () => {
  assert.deepEqual(parseArgs(["add", "x", "--body=a=b"]).flags, { body: "a=b" });
});

test("collects a repeated flag", () => {
  assert.deepEqual(parseArgs(["add", "x", "--tag", "a", "--tag=b"]).flags, { tag: ["a", "b"] });
});

test("a switch has no value", () => {
  assert.deepEqual(parseArgs(["list", "--all"]).flags, { all: true });
});

test("a flag that needs a value and has none is an error", () => {
  assert.throws(() => parseArgs(["add", "x", "--body"]), /--body needs a value/);
});

test("no command is help", () => {
  assert.equal(parseArgs([]).command, "help");
});
