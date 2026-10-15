import { expect, it, vi } from "vitest";
import { runCommand } from "./process";
vi.mock("./process", () => ({ runCommand: vi.fn() }));
it("probe rejected value", async () => {
  vi.mocked(runCommand).mockRejectedValue(new Error("boom"));
  expect(await runCommand("x", []).catch(() => null)).toBeNull();
});
it("probe Promise.reject", async () => {
  vi.mocked(runCommand).mockImplementation(() => Promise.reject(new Error("boom")));
  expect(await runCommand("x", []).catch(() => null)).toBeNull();
});
it("probe local fn", async () => {
  const f = vi.fn(); f.mockRejectedValue(new Error("boom"));
  expect(await f().catch(() => null)).toBeNull();
});
