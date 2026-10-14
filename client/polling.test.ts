import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { polled } from "./polling";

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

/** Mounts a pane's query (an observer, as `useQuery` makes) and waits for its data; returns how to unmount it. */
async function mount(client: QueryClient, queryFn: () => Promise<string>, options: object) {
  const observer = new QueryObserver(client, { queryKey: ["taro", "board", "notes-app"], queryFn, ...options });
  const unsubscribe = observer.subscribe(() => undefined);
  await client.fetchQuery({ queryKey: ["taro", "board", "notes-app"], queryFn, ...options });
  return { unsubscribe, data: () => observer.getCurrentResult().data };
}

describe("polled", () => {
  it("shows a pane mounted again within the poll interval its cached data without asking the daemon again", async () => {
    const client = new QueryClient();
    clients.push(client);
    let reads = 0;
    const read = async () => `board ${++reads}`;
    const first = await mount(client, read, polled(4_000));
    first.unsubscribe();
    const again = await mount(client, read, polled(4_000));
    expect(reads).toBe(1);
    expect(again.data()).toBe("board 1");
    again.unsubscribe();
  });

  it("is what makes the difference: without it every mount reads again", async () => {
    const client = new QueryClient();
    clients.push(client);
    let reads = 0;
    const read = async () => `board ${++reads}`;
    const first = await mount(client, read, { refetchInterval: 4_000 });
    first.unsubscribe();
    const again = await mount(client, read, { refetchInterval: 4_000 });
    expect(reads).toBe(2);
    again.unsubscribe();
  });

  it("still reads at once after an action asks for a refresh", async () => {
    const client = new QueryClient();
    clients.push(client);
    let reads = 0;
    const read = async () => `board ${++reads}`;
    const pane = await mount(client, read, polled(4_000));
    await client.invalidateQueries({ queryKey: ["taro", "board", "notes-app"] });
    expect(reads).toBe(2);
    pane.unsubscribe();
  });

  it("keeps polling at the interval", () => {
    expect(polled(4_000)).toEqual({ refetchInterval: 4_000, staleTime: 4_000 });
  });
});
