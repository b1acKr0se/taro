import { describe, expect, it } from "vitest";

import { MAX_IMAGE_BASE64_LENGTH, type DraftAttachment } from "../shared/attachments";
import { SHRINK_STEPS, fitImage, jpegFileName, scaledSize, shrinkImage } from "./image-shrink";

const LARGE = "A".repeat(MAX_IMAGE_BASE64_LENGTH + 4);
const image = (data: string, extra: Partial<DraftAttachment> = {}): DraftAttachment => ({
  id: "1",
  kind: "image",
  fileName: "IMG_1.png",
  mimeType: "image/png",
  data,
  ...extra,
});

describe("scaledSize", () => {
  it("scales the longest edge down to the maximum, keeping the shape", () => {
    expect(scaledSize(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(scaledSize(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(scaledSize(4000, 4000, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it("never enlarges, and keeps at least one pixel", () => {
    expect(scaledSize(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(2048, 1, 1024)).toEqual({ width: 1024, height: 1 });
    expect(scaledSize(0, 0, 1024)).toEqual({ width: 1, height: 1 });
  });
});

describe("jpegFileName", () => {
  it("swaps the extension for .jpg, or adds one", () => {
    expect(jpegFileName("IMG_1.HEIC")).toBe("IMG_1.jpg");
    expect(jpegFileName("shot.v2.png")).toBe("shot.v2.jpg");
    expect(jpegFileName("photo")).toBe("photo.jpg");
    expect(jpegFileName(".hidden")).toBe(".hidden.jpg");
  });
});

describe("shrinkImage", () => {
  it("leaves an image within the limit, and any file, untouched without encoding", async () => {
    const calls: unknown[] = [];
    const encode = async (...args: unknown[]) => {
      calls.push(args);
      return { mimeType: "image/jpeg", data: "AA==" };
    };
    const fits = image("A".repeat(MAX_IMAGE_BASE64_LENGTH));
    expect(await shrinkImage(fits, encode)).toBe(fits);
    const file = image(LARGE, { kind: "file" });
    expect(await shrinkImage(file, encode)).toBe(file);
    expect(calls).toEqual([]);
  });

  it("tries the steps in order and keeps the first result that fits, as a JPEG", async () => {
    const calls: [number, number][] = [];
    const shrunk = await shrinkImage(image(LARGE), async (maxEdge, quality) => {
      calls.push([maxEdge, quality]);
      return {
        mimeType: "image/jpeg",
        data: calls.length < 3 ? LARGE : "c21hbGw=",
      };
    });
    expect(calls).toEqual(SHRINK_STEPS.slice(0, 3).map((step) => [step.maxEdge, step.quality]));
    expect(shrunk).toEqual({
      id: "1",
      kind: "image",
      fileName: "IMG_1.jpg",
      mimeType: "image/jpeg",
      data: "c21hbGw=",
    });
  });

  it("returns the image unchanged when no step fits, after trying them all", async () => {
    let calls = 0;
    const original = image(LARGE);
    const result = await shrinkImage(original, async () => {
      calls += 1;
      return { mimeType: "image/jpeg", data: LARGE };
    });
    expect(result).toBe(original);
    expect(calls).toBe(SHRINK_STEPS.length);
  });

  it("returns the image unchanged when encoding fails", async () => {
    const original = image(LARGE);
    expect(
      await shrinkImage(original, async () => {
        throw new Error("cannot decode HEIC");
      }),
    ).toBe(original);
  });

  it("ends with steps small enough for any photo: the last is at most 1024 px", () => {
    expect(Math.min(...SHRINK_STEPS.map((step) => step.maxEdge))).toBeLessThanOrEqual(1024);
  });
});

/** A stand-in for expo-image-manipulator 14's native module, recording what Taro asks of it. */
function fakeManipulator(width: number, height: number, encodedLength: (size: { width: number; height: number }, quality: number) => number) {
  const log: string[] = [];
  let open = 0;
  const module = {
    manipulate: (uri: string) => {
      open += 1;
      log.push(`manipulate ${uri}`);
      let size = { width, height };
      return {
        resize: (target: { width: number; height: number }) => {
          size = target;
          log.push(`resize ${target.width}x${target.height}`);
        },
        renderAsync: async () => {
          open += 1;
          return {
            width: size.width,
            height: size.height,
            saveAsync: async (options: { compress: number; format: string; base64: boolean }) => {
              log.push(`save ${options.format} ${options.compress} base64=${options.base64}`);
              return {
                uri: "file:///out.jpg",
                base64: "A".repeat(encodedLength(size, options.compress)),
              };
            },
            release: () => {
              open -= 1;
            },
          };
        },
        release: () => {
          open -= 1;
        },
      };
    },
  };
  return { module, log, open: () => open };
}

describe("fitImage on the phone", () => {
  it("shrinks through ExpoImageManipulator, reading the picked file's uri", async () => {
    const fake = fakeManipulator(4032, 3024, (size) => (size.width > 1600 ? MAX_IMAGE_BASE64_LENGTH + 4 : 1000));
    const fitted = await fitImage(
      { expo: { modules: { ExpoImageManipulator: fake.module } } },
      "ios",
      image(LARGE, { fileName: "IMG_1.HEIC", mimeType: "image/heic" }),
      "file:///IMG_1.HEIC",
    );
    expect(fitted).toMatchObject({
      fileName: "IMG_1.jpg",
      mimeType: "image/jpeg",
      data: "A".repeat(1000),
    });
    expect(fake.log).toEqual([
      "manipulate file:///IMG_1.HEIC",
      "manipulate file:///IMG_1.HEIC",
      "resize 2048x1536",
      "save jpeg 0.85 base64=true",
      "manipulate file:///IMG_1.HEIC",
      "resize 1568x1176",
      "save jpeg 0.8 base64=true",
    ]);
    expect(fake.open()).toBe(0);
  });

  it("uses a data URL when there is no file, as for a pasted image", async () => {
    const fake = fakeManipulator(100, 100, () => 10);
    await fitImage({ expo: { modules: { ExpoImageManipulator: fake.module } } }, "android", image(LARGE));
    expect(fake.log[0]).toBe(`manipulate data:image/png;base64,${LARGE}`);
  });

  it("leaves the image for the composer to refuse when the app has no manipulator, or it throws", async () => {
    const original = image(LARGE);
    expect(await fitImage({ expo: { modules: {} } }, "ios", original, "file:///a.jpg")).toBe(original);
    expect(await fitImage({}, "ios", original, "file:///a.jpg")).toBe(original);
    const throwing = {
      manipulate: () => {
        throw new Error("Could not load the image");
      },
    };
    expect(await fitImage({ expo: { modules: { ExpoImageManipulator: throwing } } }, "ios", original, "file:///a.jpg")).toBe(original);
  });

  it("does not touch an image that fits", async () => {
    const fake = fakeManipulator(100, 100, () => 10);
    const small = image("AA==");
    expect(await fitImage({ expo: { modules: { ExpoImageManipulator: fake.module } } }, "ios", small, "file:///a.jpg")).toBe(small);
    expect(fake.log).toEqual([]);
  });
});

describe("fitImage on the web", () => {
  /** A browser's Image and canvas: the canvas's JPEG is as long as its pixel count says. */
  function browser(width: number, height: number, bytesPerPixel: number, failLoad = false) {
    const drawn: string[] = [];
    function FakeImage(this: Record<string, unknown>) {
      this.naturalWidth = width;
      this.naturalHeight = height;
      Object.defineProperty(this, "src", {
        set: (url: string) => {
          drawn.push(`load ${url.slice(0, 22)}`);
          queueMicrotask(() => (failLoad ? (this.onerror as () => void)() : (this.onload as () => void)()));
        },
      });
    }
    const document = {
      createElement: (tag: string) => {
        const canvas: Record<string, unknown> = {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: "",
            fillRect: () => drawn.push(`fill ${canvas.width}x${canvas.height}`),
            drawImage: () => drawn.push(`draw ${canvas.width}x${canvas.height}`),
          }),
          toDataURL: (type: string, quality: number) => {
            drawn.push(`encode ${type} ${quality}`);
            return `data:${type};base64,${"A".repeat(Math.round((canvas.width as number) * (canvas.height as number) * bytesPerPixel))}`;
          },
        };
        drawn.push(`create ${tag}`);
        return canvas;
      },
    };
    return { root: { Image: FakeImage, document }, drawn };
  }

  it("draws the image smaller on a canvas until its JPEG fits", async () => {
    const { root, drawn } = browser(4000, 3000, 1);
    const fitted = await fitImage(root, "web", image(LARGE));
    expect(fitted).toMatchObject({
      fileName: "IMG_1.jpg",
      mimeType: "image/jpeg",
    });
    expect(fitted.data).toHaveLength(2048 * 1536);
    expect(drawn).toEqual(["load data:image/png;base64,", "create canvas", "fill 2048x1536", "draw 2048x1536", "encode image/jpeg 0.85"]);
  });

  it("leaves an image the browser cannot read for the composer to refuse", async () => {
    const { root } = browser(4000, 3000, 1, true);
    const original = image(LARGE, { mimeType: "image/heic" });
    expect(await fitImage(root, "web", original)).toBe(original);
  });
});
