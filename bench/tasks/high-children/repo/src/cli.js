import { parseArgs } from "./args.js";
import { formatList, formatNote } from "./format.js";
import { addNote, editNote, getNote, listNotes, removeNote } from "./notes.js";
import { loadState, saveState } from "./store.js";

const HELP = `usage: notes <command>

  add <title> [--body <text>] [--tag <tag>]...   add a note
  list [--tag <tag>]                             list notes
  show <id>                                      print one note
  edit <id> [--title <t>] [--body <t>] [--tag <t>]...
  rm <id>                                        remove a note
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
