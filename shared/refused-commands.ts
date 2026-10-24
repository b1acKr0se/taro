/**
 * Slash commands Taro keeps away from its agents (TR-232). Claude's `/clear` (also `/reset` and `/new`)
 * starts the session over with empty context: an owner or the manager would forget its role, ticket and
 * plan, and Taro reloads its rules only after a compaction. Paseo's `/exit` closes the agent. None of them
 * is offered in the `/` list, and a message that starts with one of Claude's is not sent: the box refuses
 * it before anything changes, and the server refuses it too for any path that skips the box.
 */

/** Left out of the `/` list. */
export const UNLISTED_COMMANDS: ReadonlySet<string> = new Set(["clear", "reset", "new", "exit"]);

/** Never sent as a message's first word. */
const REFUSED_COMMANDS: ReadonlySet<string> = new Set(["clear", "reset", "new"]);

/** Why the message is not sent, or null when it may go: only a refused command as its first word counts. */
export function refusedMessage(text: string): string | null {
  const match = /^\s*\/([A-Za-z]+)(?=\s|$)/.exec(text);
  if (match === null) return null;
  const name = match[1]!.toLowerCase();
  return REFUSED_COMMANDS.has(name) ? `/${name} is not available in this plugin.` : null;
}
