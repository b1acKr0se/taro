/** `2026-01-05T10:00:00.000Z` as `2026-01-05 10:00`. */
export function formatDate(iso) {
  return iso.slice(0, 16).replace("T", " ");
}

/** One line per note: `#3  Buy milk  [home, errands]`. */
export function formatList(notes) {
  if (notes.length === 0) return "No notes.\n";
  return `${notes.map((note) => `#${note.id}  ${note.title}${note.tags.length === 0 ? "" : `  [${note.tags.join(", ")}]`}`).join("\n")}\n`;
}

/** A whole note: its title, tags, dates and body. */
export function formatNote(note) {
  const lines = [`#${note.id} ${note.title}`];
  if (note.tags.length > 0) lines.push(`tags: ${note.tags.join(", ")}`);
  lines.push(`created: ${formatDate(note.created)}`, `updated: ${formatDate(note.updated)}`);
  if (note.body !== "") lines.push("", note.body);
  return `${lines.join("\n")}\n`;
}
