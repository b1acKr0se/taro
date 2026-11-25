import { describe, expect, it } from "vitest";
import { measureBlocks, type Measurable } from "./fold-lines";

const BODY = { name: "body" };

/** A node that answers its measure with `top` and `height`, at once (as a phone's Fabric does) or later (as the web does). */
function answering(top: number, height: number, later = false): Measurable {
  return {
    measureLayout: (relativeTo, onSuccess) => {
      expect(relativeTo).toBe(BODY);
      if (later) setTimeout(() => onSuccess(0, top, 300, height), 0);
      else onSuccess(0, top, 300, height);
    },
  };
}

const failing: Measurable = { measureLayout: (_relativeTo, _onSuccess, onFail) => onFail() };
const throwing: Measurable = {
  measureLayout: () => {
    throw new Error("detached");
  },
};
const plain = {};

/** Runs `measureBlocks` to its end, counting how often it hands over. */
async function measure(body: unknown, nodes: [unknown, number | null][]): Promise<{ calls: number; blocks: unknown }> {
  let calls = 0;
  let blocks: unknown;
  measureBlocks(body, new Map(nodes), (result) => {
    calls += 1;
    blocks = result;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { calls, blocks };
}

describe("measureBlocks", () => {
  it("hands over every block once all have answered, at once or later", async () => {
    const { calls, blocks } = await measure(BODY, [
      [answering(0, 66), 22],
      [answering(80, 40, true), null],
    ]);
    expect(calls).toBe(1);
    expect(blocks).toEqual([
      { top: 0, height: 66, lineHeight: 22 },
      { top: 80, height: 40, lineHeight: null },
    ]);
  });

  it("leaves out a block whose measure fails, throws or cannot be taken, and still hands over once", async () => {
    const { calls, blocks } = await measure(BODY, [
      [failing, 22],
      [answering(22, 44), 22],
      [throwing, 22],
      [plain, null],
    ]);
    expect(calls).toBe(1);
    expect(blocks).toEqual([{ top: 22, height: 44, lineHeight: 22 }]);
  });

  it("hands over null once when no block could be measured", async () => {
    expect(await measure(BODY, [[failing, 22], [throwing, null], [plain, 22]])).toEqual({ calls: 1, blocks: null });
  });

  it("hands over null once with no blocks or no body", async () => {
    expect(await measure(BODY, [])).toEqual({ calls: 1, blocks: null });
    expect(await measure(null, [[answering(0, 22), 22]])).toEqual({ calls: 1, blocks: null });
  });
});
