import { describe, expect, it } from "vitest";

import { sourceOf } from "./image-source";

describe("sourceOf", () => {
  it("reads a daemon file through the plugin", () => {
    expect(sourceOf("/home/user/project/shot.png")).toEqual({ kind: "local", path: "/home/user/project/shot.png" });
    expect(sourceOf("file:///home/user/project/shot.png")).toEqual({ kind: "local", path: "file:///home/user/project/shot.png" });
  });

  it("draws an https image as it is", () => {
    expect(sourceOf("https://example.com/a.png")).toEqual({ kind: "remote", uri: "https://example.com/a.png" });
  });

  it("draws a composer attachment's inline image as it is (TR-192)", () => {
    expect(sourceOf("data:image/png;base64,iVBORw0KGgo=")).toEqual({ kind: "inline", uri: "data:image/png;base64,iVBORw0KGgo=" });
    expect(sourceOf("data:image/jpeg;name=a.jpg;base64,/9j/")).toEqual({ kind: "inline", uri: "data:image/jpeg;name=a.jpg;base64,/9j/" });
  });

  it("draws nothing else", () => {
    expect(sourceOf("data:text/html;base64,PGI+")).toEqual({ kind: "none" });
    expect(sourceOf("data:image/svg+xml,<svg/>")).toEqual({ kind: "none" });
    expect(sourceOf("data:image/;base64,AAAA")).toEqual({ kind: "none" });
    expect(sourceOf("http://example.com/a.png")).toEqual({ kind: "none" });
    expect(sourceOf("shot.png")).toEqual({ kind: "none" });
    expect(sourceOf("")).toEqual({ kind: "none" });
  });
});
