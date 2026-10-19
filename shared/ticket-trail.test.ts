// TR-187: a parent's child rows open the child in place, and its back row returns to the parent.
import { describe, expect, it } from "vitest";

import { goBack, openChild, startTrail, trailFor, trailView } from "./ticket-trail";

describe("ticket trail", () => {
  it("shows the root with no back row until a child opens", () => {
    expect(trailView(startTrail("NA-1"))).toEqual({ shown: "NA-1", back: null });
  });

  it("shows an opened child with a back row to its parent, and back returns there", () => {
    const opened = openChild(startTrail("NA-1"), "NA-1.02");
    expect(trailView(opened)).toEqual({ shown: "NA-1.02", back: "NA-1" });
    expect(trailView(goBack(opened))).toEqual({ shown: "NA-1", back: null });
  });

  it("steps back one level at a time from a grandchild", () => {
    const deep = openChild(openChild(startTrail("NA-1"), "NA-1.02"), "NA-1.02.01");
    expect(trailView(deep)).toEqual({ shown: "NA-1.02.01", back: "NA-1.02" });
    expect(trailView(goBack(deep))).toEqual({ shown: "NA-1.02", back: "NA-1" });
  });

  it("stays at the root when back is pressed there", () => {
    expect(trailView(goBack(startTrail("NA-1")))).toEqual({ shown: "NA-1", back: null });
  });

  it("starts over when another ticket is shown in the same place", () => {
    const opened = openChild(startTrail("NA-1"), "NA-1.02");
    expect(trailFor(opened, "NA-1")).toBe(opened);
    expect(trailView(trailFor(opened, "NA-2"))).toEqual({ shown: "NA-2", back: null });
  });
});
