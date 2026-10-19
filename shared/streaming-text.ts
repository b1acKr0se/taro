/**
 * What a chat draws of a reply still being written (TR-144). A decision block parses only once
 * closed, and a status line means something only once whole, so while the agent writes the newest
 * reply the chat leaves out an unclosed block, showing a quiet line in its place, and a status line
 * in progress.
 * The finished turn is read as before: this changes only the drawing.
 */

export const WRITING_A_QUESTION = "Writing a question…";

const OPENERS = ["```decision", "```taro-decision"];
const CLOSED = /^```(?:taro-)?decision[^\n]*\n[\s\S]*?```/;
const STATES = ["working:", "waiting:", "blocked:", "done:", "failed:"];

/** Whether `line` is a status line, or could still become one as more is written. */
function startsStatusLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (trimmed === "") return false;
  return STATES.some((state) => trimmed.startsWith(state) || state.startsWith(trimmed));
}

export interface HeldText {
  text: string;
  /** An unclosed decision block was left out: the chat says `WRITING_A_QUESTION` in its place. */
  asking: boolean;
}

/**
 * The newest reply as drawn while it is written: an unclosed decision block, and all after it, is
 * left out and `asking` set; a last line that is, or may become, a status line or a block's opening
 * fence is left out until the next piece or the turn's end.
 */
export function heldWhileWriting(text: string): HeldText {
  const opened = Math.max(...OPENERS.map((opener) => text.lastIndexOf(opener)));
  if (opened !== -1 && !CLOSED.test(text.slice(opened))) return { text: text.slice(0, opened).replace(/\s+$/, ""), asking: true };
  const lineStart = text.lastIndexOf("\n") + 1;
  const last = text.slice(lineStart);
  const fence = last.trimStart();
  if (startsStatusLine(last) || (fence.length >= 3 && OPENERS.some((opener) => opener.startsWith(fence)))) return { text: text.slice(0, lineStart).replace(/\s+$/, ""), asking: false };
  return { text, asking: false };
}
