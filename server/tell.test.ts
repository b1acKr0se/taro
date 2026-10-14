/** Telling an agent or a project's manager, with words, attachments, or both (TR-036). */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tellAgent as tellAgentRpc, tellManager as tellManagerRpc } from "../shared/contracts";
import { Actions } from "./actions";
import { fetchLiveAgent } from "./agents";
import type { PaseoAgent, PaseoApi } from "./host-types";
import { tellManager } from "./manager";
import type { Recovery } from "./recovery";
import type { PluginState } from "./state";
import type { Stats } from "./stats";
import type { Supervisor } from "./supervision";
import type { TrackerWatch } from "./tracker-watch";

vi.mock("./agents", async (original) => ({ ...(await original<typeof import("./agents")>()), fetchLiveAgent: vi.fn() }));
vi.mock("./projects", async (original) => ({
  ...(await original<typeof import("./projects")>()),
  requireProjectConfig: async (project: string) => ({ project, managerAgentId: "manager-1" }),
}));

const base64 = (text: string) => Buffer.from(text).toString("base64");
const IMAGE = { mimeType: "image/png", data: base64("png") };
const FILE = { fileName: "notes.txt", mimeType: "text/plain", data: base64("notes") };

let home: string;
let previousHome: string | undefined;
let live: string[];
let sent: { agentId: string; text: string; options: { images?: unknown[]; attachments?: unknown[] } }[];
let paseo: PaseoApi;
let actions: Actions;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "taro-tell-"));
  previousHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  live = ["agent-1", "manager-1"];
  sent = [];
  vi.mocked(fetchLiveAgent).mockImplementation(async (_paseo, id) => (live.includes(id) ? ({ id, status: "idle" } as unknown as PaseoAgent) : null));
  paseo = {
    agents: { ref: (agentId: string) => ({ send: async (text: string, options: (typeof sent)[number]["options"]) => void sent.push({ agentId, text, options }) }) },
  } as unknown as PaseoApi;
  actions = new Actions({} as PluginState, {} as Supervisor, {} as TrackerWatch, {} as Stats, {} as Recovery);
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(home, { recursive: true, force: true });
});

async function uploads(): Promise<string[]> {
  return readdir(join(home, "uploads")).catch(() => []);
}

describe("telling an agent", () => {
  it("sends trimmed words alone, as before", async () => {
    await actions.tellAgent(paseo, "agent-1", "  hello  ");
    expect(sent).toEqual([{ agentId: "agent-1", text: "hello", options: expect.not.objectContaining({ images: expect.anything() }) }]);
  });

  it("sends attachments with no words", async () => {
    await actions.tellAgent(paseo, "agent-1", "   ", { images: [IMAGE], files: [FILE] });
    expect(sent[0]?.text).toBe("");
    expect(sent[0]?.options.images).toEqual([IMAGE]);
    expect(sent[0]?.options.attachments).toEqual([expect.objectContaining({ type: "uploaded_file", fileName: "notes.txt", path: expect.stringContaining(join(home, "uploads")) })]);
  });

  it("still refuses a message with neither words nor attachments", async () => {
    await expect(actions.tellAgent(paseo, "agent-1", "  ", { images: [], files: [] })).rejects.toThrow("Say something first.");
    expect(sent).toEqual([]);
  });

  it("refuses an agent that is gone before writing any file", async () => {
    live = [];
    await expect(actions.tellAgent(paseo, "agent-1", "", { files: [FILE] })).rejects.toThrow("no longer running");
    expect(await uploads()).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("telling a project's manager", () => {
  it("sends attachments with no words to the manager", async () => {
    expect(await tellManager(paseo, "demo", "", { files: [FILE] })).toBe("manager-1");
    expect(sent[0]).toMatchObject({ agentId: "manager-1", text: "" });
    expect(sent[0]?.options.attachments).toHaveLength(1);
  });

  it("still refuses a message with neither words nor attachments", async () => {
    await expect(tellManager(paseo, "demo", " ")).rejects.toThrow("Say something to the Manager.");
  });

  it("refuses a project without a running manager before writing any file", async () => {
    live = [];
    await expect(tellManager(paseo, "demo", "", { files: [FILE] })).rejects.toThrow("has no Manager");
    expect(await uploads()).toEqual([]);
  });
});

describe("the tell contracts", () => {
  it("keep the images and files they carry (zod drops keys a schema does not name)", () => {
    expect(tellAgentRpc.input.parse({ agentId: "a", text: "", images: [IMAGE], files: [FILE] })).toEqual({ agentId: "a", text: "", images: [IMAGE], files: [FILE] });
    expect(tellManagerRpc.input.parse({ project: "demo", text: "", images: [IMAGE], files: [FILE] })).toEqual({ project: "demo", text: "", images: [IMAGE], files: [FILE] });
  });

  it("still take words alone, from older clients", () => {
    expect(tellAgentRpc.input.parse({ agentId: "a", text: "hi" })).toEqual({ agentId: "a", text: "hi" });
  });
});
