// TR-110: the settings form asks gh which merge methods the repository allows, and treats any failure as unknown.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { allowedMergeMethods } from "./merge-methods";
import { runCommand } from "./process";

vi.mock("./process", () => ({ runCommand: vi.fn() }));

beforeEach(() => {
  vi.mocked(runCommand).mockReset();
});

describe("allowedMergeMethods", () => {
  it("asks gh in the repository for the three allowed fields", async () => {
    vi.mocked(runCommand).mockResolvedValue({ code: 0, stdout: '{"mergeCommitAllowed":true,"rebaseMergeAllowed":true,"squashMergeAllowed":false}', stderr: "" });
    expect(await allowedMergeMethods("/home/user/notes-app")).toEqual({ merge: true, rebase: true, squash: false });
    expect(vi.mocked(runCommand).mock.calls[0]).toEqual(["gh", ["repo", "view", "--json", "mergeCommitAllowed,rebaseMergeAllowed,squashMergeAllowed"], { cwd: "/home/user/notes-app", timeoutMs: 15_000 }]);
  });

  it("is unknown when gh fails", async () => {
    vi.mocked(runCommand).mockResolvedValue({ code: 1, stdout: "", stderr: "no git remotes found" });
    expect(await allowedMergeMethods("/home/user/notes-app")).toBeNull();
  });

  it("is unknown when gh cannot start", async () => {
    vi.mocked(runCommand).mockImplementation(async () => {
      throw new Error("spawn gh ENOENT");
    });
    expect(await allowedMergeMethods("/home/user/notes-app")).toBeNull();
  });

  it("does not run gh for a path that is not absolute", async () => {
    expect(await allowedMergeMethods("notes-app")).toBeNull();
    expect(vi.mocked(runCommand)).not.toHaveBeenCalled();
  });
});
