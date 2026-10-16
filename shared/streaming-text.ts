/**
 * What a chat draws of a reply still being written (TR-144). A decision block parses only once
 * closed, and a status line means something only once whole, so while the agent writes the newest
 * reply the chat shows a quiet line for an unclosed block and leaves out a status line in progress.
 * The finished turn is read as before: this changes only the drawing.
 */

export const WRITING_A_QUESTION = "Writing a question…";

const OPENER = "```decision";
const CLOSED = /^```decision[^\n]*\n[\s\S]*?```/;
const STATES = ["working:", "waiting:", "blocked:", "done:", "failed:"];

/** Whether `line` is a status line, or could still become one as more is written. */
function startsStatusLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (trimmed === "") return false;
  return STATES.some((state) => trimmed.startsWith(state) || state.startsWith(trimmed));
}

/**
 * The newest reply as drawn while it is written: an unclosed decision block, and all after it,
 * becomes `WRITING_A_QUESTION`; a last line that is, or may become, a status line or a block's
 * opening fence is left out until the next piece or the turn's end.
 */
export function heldWhileWriting(text: string): string {
  const opened = text.lastIndexOf(OPENER);
  if (opened !== -1 && !CLOSED.test(text.slice(opened))) return `${text.slice(0, opened).replace(/\s+$/, "")}\n\n${WRITING_A_QUESTION}`.trimStart();
  const lineStart = text.lastIndexOf("\n") + 1;
  const last = text.slice(lineStart);
  const fence = last.trimStart();
  if (startsStatusLine(last) || (fence.length >= 3 && OPENER.startsWith(fence))) return text.slice(0, lineStart).replace(/\s+$/, "");
  return text;
}
