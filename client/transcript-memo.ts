/**
 * When a chat message needs drawing again (TR-069). Every re-read of the timeline, every refresh of
 * the board and every keystroke in the composer renders the chat, and each re-read builds new row
 * objects for the same words; a message is drawn again only when what it shows changed.
 */
import type { Group } from "./tool-runs";

/** Whether two transcript groups show the same thing: the same rows, words and tool states. */
export function sameGroup(left: Group, right: Group): boolean {
  if (left === right) return true;
  if (left.key !== right.key) return false;
  if ("tools" in left || "tools" in right) {
    if (!("tools" in left) || !("tools" in right) || left.tools.length !== right.tools.length) return false;
    return left.tools.every((tool, index) => {
      const other = right.tools[index];
      return other !== undefined && tool.key === other.key && tool.text === other.text && tool.plain === other.plain && tool.status === other.status;
    });
  }
  return left.row.kind === right.row.kind && left.row.key === right.row.key && left.row.text === right.row.text;
}

/** Whether two lists hold the same items in order, each compared with `same` (identity by default). */
export function sameItems<Item>(left: readonly Item[] | undefined, right: readonly Item[] | undefined, same: (a: Item, b: Item) => boolean = Object.is): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  return left.every((item, index) => same(item, right[index] as Item));
}
