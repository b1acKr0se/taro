import { afterEach, describe, expect, it, vi } from "vitest";

import { canCopyThumbnails, COPY_TIMEOUT_MS, copySizeFor, drawnUri, MAX_KEPT_COPIES, settledCopy, thumbnailCopy } from "./thumbnail-copy";

/**
 * A fake `ExpoImageManipulator` on a fresh root: logs each call, saves to `file:///cache/<n>.<format>`,
 * fails for a URI in `failing`, never finishes for one in `stuck`. It loads every image as 1440 × 900,
 * or 900 × 1440 for one in `sideways` (a JPEG it did not turn as its EXIF says), and keeps that shape
 * when resized by width alone.
 */
function fakeApp(failing: readonly string[] = [], { sideways = [], stuck = [] }: { sideways?: readonly string[]; stuck?: readonly string[] } = {}) {
  const log: string[] = [];
  let saved = 0;
  let inFlight = 0;
  let mostInFlight = 0;
  const module = {
    // A native module's method may need its module as `this`, so the fake does too.
    manipulate(this: unknown, uri: string) {
      if (this !== module) throw new Error("called detached");
      log.push(`manipulate ${uri}`);
      if (uri === "data:throw") throw new Error("cannot open");
      const loaded = sideways.includes(uri) ? { width: 900, height: 1440 } : { width: 1440, height: 900 };
      let size = loaded;
      return {
        resize: (asked: { width?: number; height?: number }) => {
          log.push(`resize ${JSON.stringify(asked)}`);
          if (asked.width !== undefined && asked.height === undefined) size = { width: asked.width, height: Math.round((asked.width * loaded.height) / loaded.width) };
          else size = { width: asked.width ?? 0, height: asked.height ?? 0 };
        },
        renderAsync: async () => {
          if (stuck.includes(uri)) return new Promise<never>(() => undefined);
          inFlight++;
          mostInFlight = Math.max(mostInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 1));
          inFlight--;
          if (failing.includes(uri)) throw new Error("cannot decode");
          return {
            width: size.width,
            height: size.height,
            saveAsync: async (options: { format: string; compress?: number; base64?: boolean }) => {
              log.push(`save ${options.format}${options.compress === undefined ? "" : ` ${options.compress}`}${options.base64 === true ? " base64" : ""}`);
              saved++;
              return { uri: `file:///cache/${saved}.${options.format}`, width: 1, height: 1 };
            },
            release: () => log.push("release image"),
          };
        },
        release: () => log.push("release context"),
      };
    },
  };
  const root = { expo: { modules: { ExpoImageManipulator: module } } };
  return { root, log, mostInFlight: () => mostInFlight };
}

const SIZE = { width: 768, height: 480 };

afterEach(() => {
  vi.useRealTimers();
});

describe("thumbnailCopy", () => {
  it("renders the image once at the thumbnail's size as a file, PNG for a PNG, and releases what it opened", async () => {
    const app = fakeApp();
    expect(settledCopy(app.root, "/evidence/a.png", SIZE)).toBeUndefined();
    expect(await thumbnailCopy(app.root, "/evidence/a.png", "data:image/png;base64,AAA", "image/png", SIZE)).toBe("file:///cache/1.png");
    expect(app.log).toEqual(["manipulate data:image/png;base64,AAA", 'resize {"width":768}', "save png", "release image", "release context"]);
    expect(settledCopy(app.root, "/evidence/a.png", SIZE)).toBe("file:///cache/1.png");
  });

  it("saves a JPEG as JPEG", async () => {
    const app = fakeApp();
    expect(await thumbnailCopy(app.root, "/images/photo.jpg", "data:image/jpeg;base64,AAA", "image/jpeg", SIZE)).toBe("file:///cache/1.jpeg");
    expect(app.log).toContain("save jpeg 0.9");
  });

  it("makes one copy for every thumbnail of the same image and size, and another for another size", async () => {
    const app = fakeApp();
    const [first, second] = await Promise.all([
      thumbnailCopy(app.root, "/evidence/a.png", "data:a", "image/png", SIZE),
      thumbnailCopy(app.root, "/evidence/a.png", "data:a", "image/png", SIZE),
    ]);
    expect(first).toBe(second);
    expect(await thumbnailCopy(app.root, "/evidence/a.png", "data:a", "image/png", SIZE)).toBe(first);
    expect(await thumbnailCopy(app.root, "/evidence/a.png", "data:a", "image/png", { width: 300, height: 188 })).toBe("file:///cache/2.png");
    expect(app.log.filter((line) => line.startsWith("manipulate"))).toHaveLength(2);
  });

  it("makes copies one at a time, the newest asked for first: a chat's last images are on screen", async () => {
    const app = fakeApp();
    // `a` starts at once; `b`, `c` and `d` wait, and `d`, asked for last, is made next.
    const copies = await Promise.all(["a", "b", "c", "d"].map((name) => thumbnailCopy(app.root, `/evidence/${name}.png`, `data:${name}`, "image/png", SIZE)));
    expect(copies).toEqual(["file:///cache/1.png", "file:///cache/4.png", "file:///cache/3.png", "file:///cache/2.png"]);
    expect(app.log.filter((line) => line.startsWith("manipulate"))).toEqual(["manipulate data:a", "manipulate data:d", "manipulate data:c", "manipulate data:b"]);
    expect(app.mostInFlight()).toBe(1);
  });

  it("drops a copy that came out in the other shape (a JPEG the module did not turn) for the full image", async () => {
    const app = fakeApp([], { sideways: ["data:turned"] });
    expect(await thumbnailCopy(app.root, "/images/photo.jpg", "data:turned", "image/jpeg", SIZE)).toBeNull();
    expect(app.log.some((line) => line.startsWith("save"))).toBe(false);
    expect(app.log).toContain("release image");
    expect(await thumbnailCopy(app.root, "/images/other.jpg", "data:upright", "image/jpeg", SIZE)).toBe("file:///cache/1.jpeg");
  });

  it("gives up a copy that never finishes, and makes the next", async () => {
    vi.useFakeTimers();
    const app = fakeApp([], { stuck: ["data:stuck"] });
    const stuck = thumbnailCopy(app.root, "/evidence/stuck.png", "data:stuck", "image/png", SIZE);
    const next = thumbnailCopy(app.root, "/evidence/next.png", "data:next", "image/png", SIZE);
    await vi.advanceTimersByTimeAsync(COPY_TIMEOUT_MS);
    expect(await stuck).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(await next).toBe("file:///cache/1.png");
  });

  it("remembers a failed copy as null, and the next copy is still made", async () => {
    const app = fakeApp(["data:bad"]);
    const bad = thumbnailCopy(app.root, "/evidence/bad.png", "data:bad", "image/png", SIZE);
    const thrown = thumbnailCopy(app.root, "/evidence/throw.png", "data:throw", "image/png", SIZE);
    const good = thumbnailCopy(app.root, "/evidence/good.png", "data:good", "image/png", SIZE);
    expect(await bad).toBeNull();
    expect(await thrown).toBeNull();
    expect(await good).toBe("file:///cache/1.png");
    expect(settledCopy(app.root, "/evidence/bad.png", SIZE)).toBeNull();
    expect(app.log.filter((line) => line === "release context")).toHaveLength(2);
  });

  it("is null without the module", async () => {
    expect(await thumbnailCopy({}, "/evidence/a.png", "data:a", "image/png", SIZE)).toBeNull();
  });

  it("keeps copies across a new evaluation of the bundle, as the same root", async () => {
    const app = fakeApp();
    await thumbnailCopy(app.root, "/evidence/a.png", "data:a", "image/png", SIZE);
    // A second evaluation reads the same `globalThis` slots: no second render.
    expect(await thumbnailCopy(app.root, "/evidence/a.png", "data:a", "image/png", SIZE)).toBe("file:///cache/1.png");
    expect(app.log.filter((line) => line.startsWith("manipulate"))).toHaveLength(1);
  });

  it(`keeps at most ${MAX_KEPT_COPIES} copies, dropping the oldest`, async () => {
    const app = fakeApp();
    for (let index = 0; index <= MAX_KEPT_COPIES; index++) await thumbnailCopy(app.root, `/evidence/${index}.png`, `data:${index}`, "image/png", SIZE);
    expect(settledCopy(app.root, "/evidence/0.png", SIZE)).toBeUndefined();
    expect(settledCopy(app.root, "/evidence/1.png", SIZE)).toBe("file:///cache/2.png");
    expect(settledCopy(app.root, `/evidence/${MAX_KEPT_COPIES}.png`, SIZE)).toBe(`file:///cache/${MAX_KEPT_COPIES + 1}.png`);
  });
});

describe("canCopyThumbnails", () => {
  it("only on the phone, with the module there", () => {
    expect(canCopyThumbnails(fakeApp().root, "android")).toBe(true);
    expect(canCopyThumbnails(fakeApp().root, "ios")).toBe(true);
    expect(canCopyThumbnails(fakeApp().root, "web")).toBe(false);
    expect(canCopyThumbnails({}, "android")).toBe(false);
    expect(canCopyThumbnails({ expo: { modules: { ExpoImageManipulator: {} } } }, "android")).toBe(false);
  });
});

describe("copySizeFor", () => {
  const FRAME = { width: 256, height: 160 };
  const LARGE = { width: 1440, height: 900 };

  it("asks for a copy of a large image the daemon sent, where copies can be made", () => {
    expect(copySizeFor("data:image/png;base64,AAA", LARGE, FRAME, true, 3)).toEqual({ width: 768, height: 480 });
  });

  it("asks for none on the web, before the image or its size is known, for a web image, or for a small one", () => {
    expect(copySizeFor("data:image/png;base64,AAA", LARGE, FRAME, false, 3)).toBeNull();
    expect(copySizeFor(undefined, LARGE, FRAME, true, 3)).toBeNull();
    expect(copySizeFor(null, LARGE, FRAME, true, 3)).toBeNull();
    expect(copySizeFor("data:image/png;base64,AAA", null, FRAME, true, 3)).toBeNull();
    expect(copySizeFor("https://example.com/shot.png", LARGE, FRAME, true, 3)).toBeNull();
    expect(copySizeFor("data:image/png;base64,AAA", { width: 400, height: 250 }, FRAME, true, 3)).toBeNull();
  });

  it("asks for none for a GIF, whose copy would stand still", () => {
    expect(copySizeFor("data:image/gif;base64,AAA", LARGE, FRAME, true, 3)).toBeNull();
  });
});

describe("drawnUri", () => {
  it("draws the image itself when it needs no copy, whatever it is", () => {
    expect(drawnUri("data:a", false, undefined)).toBe("data:a");
    expect(drawnUri(null, false, undefined)).toBeNull();
    expect(drawnUri(undefined, false, undefined)).toBeUndefined();
  });

  it("draws nothing while the copy is made, then the copy, or the full image when it failed", () => {
    expect(drawnUri("data:a", true, undefined)).toBeUndefined();
    expect(drawnUri("data:a", true, "file:///cache/1.png")).toBe("file:///cache/1.png");
    expect(drawnUri("data:a", true, null)).toBe("data:a");
  });
});
