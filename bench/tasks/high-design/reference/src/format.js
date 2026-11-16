/** `2026-01-05T10:00:00.000Z` as `2026-01-05 10:00`. */
export function formatDate(iso) {
  return iso.slice(0, 16).replace("T", " ");
}

/** `#3  Buy milk  [home, errands]  due 2026-03-12  done`. */
export function formatLine(note) {
  return `#${note.id}  ${note.title}${note.tags.length === 0 ? "" : `  [${note.tags.join(", ")}]`}${note.due === undefined ? "" : `  due ${note.due}`}${note.done === undefined ? "" : "  done"}`;
}

/** One line per note. */
export function formatList(notes) {
  if (notes.length === 0) return "No notes.\n";
  return `${notes.map(formatLine).join("\n")}\n`;
}

/** The agenda: a heading and the notes of each group, groups apart by a blank line. */
export function formatAgenda(groups) {
  if (groups.length === 0) return "Nothing due.\n";
  const blocks = groups.map(([name, entries]) => [
    `${name} (${entries.length})`,
    ...entries.map(({ note, ahead }) => `  ${formatLine(note)}${name === "Overdue" ? `  (${-ahead} day${ahead === -1 ? "" : "s"} late)` : ""}`),
  ].join("\n"));
  return `${blocks.join("\n\n")}\n`;
}

/** A whole note: its title, tags, dates and body. */
export function formatNote(note) {
  const lines = [`#${note.id} ${note.title}`];
  if (note.tags.length > 0) lines.push(`tags: ${note.tags.join(", ")}`);
  if (note.due !== undefined) lines.push(`due: ${note.due}`);
  lines.push(`created: ${formatDate(note.created)}`, `updated: ${formatDate(note.updated)}`);
  if (note.done !== undefined) lines.push(`done: ${note.done}`);
  if (note.body !== "") lines.push("", note.body);
  return `${lines.join("\n")}\n`;
}
