/** Flags that take a value; every other `--flag` is a switch. */
const VALUE_FLAGS = new Set(["body", "title", "tag"]);
/** Flags that may be given more than once; their values are collected in a list. */
const REPEATED_FLAGS = new Set(["tag"]);

/**
 * Splits a command line into its command, positional arguments and flags.
 * `--name=value` and `--name value` are the same; a flag that needs a value and has none is an error.
 */
export function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const positionals = [];
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index];
    if (!word.startsWith("--")) {
      positionals.push(word);
      continue;
    }
    const [name, inline] = word.slice(2).split(/=(.*)/s, 2);
    if (!VALUE_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      index += 1;
      value = rest[index];
    }
    if (value === undefined) throw new Error(`--${name} needs a value`);
    if (REPEATED_FLAGS.has(name)) flags[name] = [...(flags[name] ?? []), value];
    else flags[name] = value;
  }
  return { command, positionals, flags };
}
