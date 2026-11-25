/**
 * How the blocks of a folded message tell the fold around them where their lines are (TR-289): a block's view registers
 * with its line height (null when its lines are not known), and the fold measures each against its body to end between
 * two lines (`foldCut` in `./received-fold`). Outside a fold there is no context and nothing registers.
 */
import { createContext, useContext } from "react";

/** A ref for a block's view, given its line height; it unregisters itself when the view goes. */
export type FoldLineRef = (lineHeight: number | null) => (node: unknown) => (() => void) | undefined;

export const FoldLinesContext = createContext<FoldLineRef | null>(null);

/** The fold's ref maker, or null outside a fold. */
export function useFoldLines(): FoldLineRef | null {
  return useContext(FoldLinesContext);
}
