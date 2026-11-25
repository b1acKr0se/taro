/**
 * How the blocks of a folded message tell the fold around them where their lines are (TR-289): a block's view registers
 * with its line height (null when its lines are not known), and the fold measures each against its body to end between
 * two lines (`foldCut` in `./received-fold`). Outside a fold there is no context and nothing registers.
 */
import { createContext, useContext } from "react";
import type { FoldBlock } from "./received-fold";

/** A ref for a block's view, given its line height; it unregisters itself when the view goes. */
export type FoldLineRef = (lineHeight: number | null) => (node: unknown) => (() => void) | undefined;

export const FoldLinesContext = createContext<FoldLineRef | null>(null);

/** The fold's ref maker, or null outside a fold. */
export function useFoldLines(): FoldLineRef | null {
  return useContext(FoldLinesContext);
}

/** A view the fold can measure against another: React Native's and react-native-web's host views both have it. */
export interface Measurable {
  measureLayout?: (relativeTo: unknown, onSuccess: (x: number, y: number, width: number, height: number) => void, onFail: () => void) => void;
}

/** Measures each registered block against the body, then hands the blocks over; null when nothing can be measured. */
export function measureBlocks(body: unknown, registered: Map<unknown, number | null>, done: (blocks: FoldBlock[] | null) => void): void {
  const entries = Array.from(registered.entries());
  if (body === null || entries.length === 0) {
    done(null);
    return;
  }
  const blocks: FoldBlock[] = [];
  let left = entries.length;
  const settle = () => {
    left -= 1;
    if (left === 0) done(blocks.length === 0 ? null : blocks);
  };
  entries.map(([node, lineHeight]) => {
    const measurable = node as Measurable;
    if (typeof measurable.measureLayout !== "function") {
      settle();
      return;
    }
    try {
      measurable.measureLayout(
        body,
        (_x, y, _width, height) => {
          blocks.push({ top: y, height, lineHeight });
          settle();
        },
        settle,
      );
    } catch {
      settle();
    }
  });
}
