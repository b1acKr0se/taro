import { parseArgs } from "./args.js";
import { formatList, formatNote } from "./format.js";
import { mergeNotes } from "./merge.js";
import { addNote, editNote, getNote, listNotes, removeNote } from "./notes.js";
import { existsSync } from "node:fs";
import { loadState, saveState } from "./store.js";

const HELP = `usage: notes <command>

  add <title> [--body <text>] [--tag <tag>]...   add a note
  list [--tag <tag>]                             list notes
  show <id>                                      print one note
  edit <id> [--title <t>] [--body <t>] [--tag <t>]...
  rm <id>                                        remove a note
  merge <file>                                   add the notes of another notes file
`;

const COMMANDS = {
  add({ positionals, flags }, state) {
    const note = addNote(state, { title: positionals.join(" "), body: flags.body, tags: flags.tag });
    saveState(state);
    return `added #${note.id}\n`;
  },
  list({ flags }, state) {
    return formatList(listNotes(state, { tag: flags.tag?.[0] }));
  },
  show({ positionals }, state) {
    return formatNote(getNote(state, positionals[0]));
  },
  edit({ positionals, flags }, state) {
    const note = editNote(state, positionals[0], { title: flags.title, body: flags.body, tags: flags.tag });
    saveState(state);
    return `edited #${note.id}\n`;
  },
  merge({ positionals }, state) {
    const path = positionals[0];
    if (path === undefined) throw new Error("merge needs a file");
    if (!existsSync(path)) throw new Error(`no notes file at ${path}`);
    const { added, already, renumbered } = mergeNotes(state, loadState(path));
    if (added > 0) saveState(state);
    const lines = renumbered.map((entry) => `#${entry.from} -> #${entry.to}  ${entry.title}\n`);
    return `${lines.join("")}merged ${added} note${added === 1 ? "" : "s"}, ${already} already there\n`;
  },
  rm({ positionals }, state) {
    const note = removeNote(state, positionals[0]);
    saveState(state);
    return `removed #${note.id}\n`;
  },
};

/** Runs one command line. Returns the exit code; output goes through `out` and `err`. */
export function run(argv, { out, err }) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    err(`${error.message}\n`);
    return 1;
  }
  const command = COMMANDS[parsed.command];
  if (command === undefined) {
    (parsed.command === "help" ? out : err)(HELP);
    return parsed.command === "help" ? 0 : 1;
  }
  try {
    out(command(parsed, loadState()));
    return 0;
  } catch (error) {
    err(`${error.message}\n`);
    return 1;
  }
}
