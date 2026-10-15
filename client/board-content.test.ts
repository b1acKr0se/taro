import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import type { Board, Card } from "../shared/contracts";
import { boardContent } from "./board-content";
import { polled } from "./polling";

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

/** A board as the daemon answers it; only the cards' identity matters here. */
function board(titles: string[], loadedAt: string, threads: number): Board {
  const cards = titles.map((title, index) => ({ id: `NA-00${index + 1}`, title }) as unknown as Card);
  return { project: "notes-app", cards, managerDecisions: [], ticketQuestions: 0, managerPermission: null, suggestions: [], headroom: { current: threads, max: 2048, high: false, highSince: null }, alerts: [], loadedAt, totals: { "needs-you": 0, working: 0, stalled: 0, queued: 0, done: 0 }, offPage: [] } as Board;
}

/** Watches the board as a pane's `useQuery` does, counting how often it would be drawn again. */
async function watch(answers: Board[]) {
  const client = new QueryClient();
  clients.push(client);
  let reads = 0;
  const queryFn = async () => answers[Math.min(reads++, answers.length - 1)];
  const observer = new QueryObserver(client, { queryKey: ["taro", "board", "notes-app"], queryFn, ...polled(4_000), select: boardContent });
  let notified = 0;
  let lastData: unknown = undefined;
  const unsubscribe = observer.subscribe((result) => {
    if (result.data !== lastData) notified += 1;
    lastData = result.data;
  });
  await observer.refetch();
  const first = observer.getCurrentResult().data;
  await observer.refetch();
  const second = observer.getCurrentResult().data;
  unsubscribe();
  return { first, second, notified };
}

describe("boardContent", () => {
  it("keeps the board a pane draws the same object when a refresh changes only the load time and thread count", async () => {
    const { first, second, notified } = await watch([board(["Export notes", "Sync offline"], "2026-01-01T00:00:00Z", 900), board(["Export notes", "Sync offline"], "2026-01-01T00:00:04Z", 996)]);
    expect(second).toBe(first);
    expect(notified).toBe(1);
  });

  it("hands over new content when a card changed, keeping the cards that did not", async () => {
    const { first, second, notified } = await watch([board(["Export notes", "Sync offline"], "2026-01-01T00:00:00Z", 900), board(["Export notes", "Sync offline, part 2"], "2026-01-01T00:00:04Z", 900)]);
    expect(second).not.toBe(first);
    expect(second?.cards[0]).toBe(first?.cards[0]);
    expect(second?.cards[1]?.title).toBe("Sync offline, part 2");
    expect(notified).toBe(2);
  });

  it("leaves out only the load time and thread count", () => {
    const answer = board([], "2026-01-01T00:00:00Z", 900);
    expect(Object.keys(boardContent(answer)).sort()).toEqual(["alerts", "cards", "managerDecisions", "managerPermission", "offPage", "suggestions", "totals"]);
  });
});
