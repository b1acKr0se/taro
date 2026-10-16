import { describe, expect, it } from "vitest";

import { addOlderPage, joinTail, withOlder, type OlderPages, type Placed } from "./older-pages";

/** Entries covering one seq each, from `from` to `to`. */
function entries(from: number, to: number): Placed[] {
  return Array.from({ length: to - from + 1 }, (_, index) => ({ seqStart: from + index, seqEnd: from + index }));
}

const seqs = (list: readonly Placed[]) => list.map((entry) => entry.seqStart);

describe("addOlderPage", () => {
  it("puts a page before the tail, and says whether the daemon has more", () => {
    const tail = entries(100, 249);
    const older = addOlderPage(null, tail[0], "e1", { epoch: "e1", entries: entries(0, 99), hasOlder: true });
    expect(seqs(withOlder(older, tail))).toEqual([...seqs(entries(0, 99)), ...seqs(tail)]);
    expect(older?.hasOlder).toBe(true);
  });

  it("puts a second page before the first", () => {
    const first = addOlderPage(null, { seqStart: 200, seqEnd: 200 }, "e1", { epoch: "e1", entries: entries(100, 199), hasOlder: true });
    const second = addOlderPage(first, first?.entries[0], "e1", { epoch: "e1", entries: entries(0, 99), hasOlder: false });
    expect(seqs(second?.entries ?? [])).toEqual(seqs(entries(0, 199)));
    expect(second?.hasOlder).toBe(false);
  });

  it("drops what the page shares with what is drawn, so no entry shows twice", () => {
    const older = addOlderPage(null, { seqStart: 100, seqEnd: 100 }, "e1", { epoch: "e1", entries: entries(50, 100), hasOlder: true });
    expect(seqs(older?.entries ?? [])).toEqual(seqs(entries(50, 99)));
  });

  it("drops an entry the page has that runs into what is drawn", () => {
    const page = [...entries(90, 98), { seqStart: 99, seqEnd: 101 }];
    const older = addOlderPage(null, { seqStart: 100, seqEnd: 105 }, "e1", { epoch: "e1", entries: page, hasOlder: true });
    expect(seqs(older?.entries ?? [])).toEqual(seqs(entries(90, 98)));
  });

  it("ends the paging when a page adds nothing, so the same page is never read forever", () => {
    const older = addOlderPage(null, { seqStart: 100, seqEnd: 100 }, "e1", { epoch: "e1", entries: entries(100, 120), hasOlder: true });
    expect(older?.entries).toEqual([]);
    expect(older?.hasOlder).toBe(false);
  });

  it("reaches the start on an empty page", () => {
    const older = addOlderPage(null, { seqStart: 0, seqEnd: 0 }, "e1", { epoch: "e1", entries: [], hasOlder: false });
    expect(older?.hasOlder).toBe(false);
  });

  it("ignores a page from another epoch: the timeline was replaced while it was read", () => {
    const kept: OlderPages<Placed> = { epoch: "e1", entries: entries(50, 99), hasOlder: true };
    expect(addOlderPage(kept, kept.entries[0], "e1", { epoch: "e2", entries: entries(0, 49), hasOlder: false })).toBe(kept);
  });
});

describe("joinTail", () => {
  const older: OlderPages<Placed> = { epoch: "e1", entries: entries(0, 99), hasOlder: true };

  it("keeps nothing when no page was read", () => {
    expect(joinTail(null, entries(100, 249), { epoch: "e1", entries: entries(101, 250), hasOlder: true })).toBeNull();
  });

  it("keeps the entries the tail moved past as new ones arrived", () => {
    const joined = joinTail(older, entries(100, 249), { epoch: "e1", entries: entries(103, 252), hasOlder: true });
    expect(seqs(withOlder(joined, entries(103, 252)))).toEqual(seqs(entries(0, 252)));
    expect(joined?.hasOlder).toBe(true);
  });

  it("keeps them while the first page is still being read", () => {
    const reading: OlderPages<Placed> = { epoch: "e1", entries: [], hasOlder: true };
    const joined = joinTail(reading, entries(100, 249), { epoch: "e1", entries: entries(110, 259), hasOlder: true });
    const paged = addOlderPage(joined, { seqStart: 100, seqEnd: 100 }, "e1", { epoch: "e1", entries: entries(0, 99), hasOlder: false });
    expect(seqs(withOlder(paged, entries(110, 259)))).toEqual(seqs(entries(0, 259)));
  });

  it("keeps them over many reads, each moving the tail a little", () => {
    let kept: OlderPages<Placed> | null = older;
    let previous = entries(100, 249);
    for (let end = 250; end <= 400; end += 30) {
      const tail = entries(end - 149, end);
      kept = joinTail(kept, previous, { epoch: "e1", entries: tail, hasOlder: true });
      previous = tail;
    }
    expect(seqs(withOlder(kept, previous))).toEqual(seqs(entries(0, 400)));
  });

  it("is unchanged by a re-read of the same tail", () => {
    const joined = joinTail(older, entries(100, 249), { epoch: "e1", entries: entries(100, 249), hasOlder: true });
    expect(seqs(joined?.entries ?? [])).toEqual(seqs(older.entries));
  });

  it("starts over on a new epoch: the timeline was replaced", () => {
    expect(joinTail(older, entries(100, 249), { epoch: "e2", entries: entries(0, 149), hasOlder: false })).toBeNull();
  });

  it("starts over when the tail moved past the whole last read, leaving entries never read", () => {
    expect(joinTail(older, entries(100, 249), { epoch: "e1", entries: entries(400, 549), hasOlder: true })).toBeNull();
  });

  it("keeps the pages when the tail reads empty", () => {
    expect(joinTail(older, entries(100, 249), { epoch: "e1", entries: [], hasOlder: false })).toBe(older);
  });

  it("keeps the start reached", () => {
    const start: OlderPages<Placed> = { ...older, hasOlder: false };
    expect(joinTail(start, entries(100, 249), { epoch: "e1", entries: entries(101, 250), hasOlder: true })?.hasOlder).toBe(false);
  });
});

describe("withOlder", () => {
  it("is the tail alone with no pages", () => {
    const tail = entries(0, 3);
    expect(withOlder(null, tail)).toBe(tail);
  });
});
