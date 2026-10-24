import { describe, expect, it } from "vitest";

import { applyPick, findActiveTrigger, type AgentCommand, type FileIndex, type TicketSummary } from "../shared/composer-picks";
import {
  activeTrigger,
  browseTo,
  createCursorStore,
  fileRowParts,
  keptDismissal,
  headingBefore,
  markedPieces,
  NO_COMMANDS_TEXT,
  parentFolder,
  pickKeyAction,
  pickListView,
  pickOf,
  scrollToShow,
  selectedIndex,
  ticketStatusTone,
  triggerIdentity,
  type PickSources,
} from "./pick-list-state";

const COMMANDS: AgentCommand[] = [
  { name: "compact", description: "Clear history but keep a summary", argumentHint: "[instructions]" },
  { name: "context", description: "Show what fills the context window", argumentHint: "" },
  { name: "code-review", description: "Review the diff", argumentHint: "", kind: "skill" },
];
const FILES: FileIndex = {
  files: ["README.md", "client/agent-chat.tsx", "client/reply-box.tsx", "shared/notes.ts"],
  changed: [{ path: "client/agent-chat.tsx", status: "changed" }],
  recent: ["shared/notes.ts"],
  truncated: false,
};
const TICKETS: TicketSummary[] = [
  { id: "TR-001", title: "Compose a note", status: "Done" },
  { id: "TR-002", title: "Search notes", status: "In Progress" },
];

function sources(overrides: Partial<PickSources> = {}): PickSources {
  return {
    commands: { status: "ready", data: { commands: COMMANDS, error: null } },
    recent: [],
    files: { status: "ready", data: FILES },
    tickets: { status: "ready", data: TICKETS },
    ...overrides,
  };
}

function viewFor(text: string, given: PickSources = sources(), cursor = text.length) {
  return pickListView(findActiveTrigger(text, cursor), given);
}

describe("pickListView", () => {
  it("opens no list without a trigger word at the cursor", () => {
    expect(viewFor("hello there")).toBeNull();
    expect(pickListView(null, sources())).toBeNull();
  });

  it("lists the commands ranked for `/` at the start, best first", () => {
    const view = viewFor("/co");
    expect(view?.trigger.kind).toBe("command");
    expect(view?.rows.map((row) => row.key)).toEqual(["command:compact", "command:context", "command:code-review"]);
    expect(view?.message).toBeNull();
  });

  it("puts the project's recent commands first for a bare `/`", () => {
    const view = viewFor("/", sources({ recent: ["code-review"] }));
    expect(view?.rows[0]?.key).toBe("command:code-review");
  });

  it("opens a `/` after other words only while something typed matches", () => {
    expect(viewFor("please /")).toBeNull();
    expect(viewFor("please /zzz")).toBeNull();
    expect(viewFor("please /comp")?.rows.map((row) => row.key)).toEqual(["command:compact"]);
    expect(viewFor("please /comp", sources({ commands: { status: "loading" } }))).toBeNull();
  });

  it("says the list loads while it does", () => {
    expect(viewFor("/", sources({ commands: { status: "loading" } }))?.message).toEqual({ text: "Loading commands…", detail: null });
    expect(viewFor("@", sources({ files: { status: "loading" } }))?.message).toEqual({ text: "Looking for files…", detail: null });
    expect(viewFor("#", sources({ tickets: { status: "loading" } }))?.message).toEqual({ text: "Loading tickets…", detail: null });
  });

  it("says nothing matched, per list", () => {
    expect(viewFor("/zzz")?.message?.text).toBe("No matching commands");
    expect(viewFor("@zzqx")?.message?.text).toBe("No matching files");
    expect(viewFor("#zzqx")?.message?.text).toBe("No matching tickets");
  });

  it("says the agent lists no commands, with the provider's error muted under it", () => {
    expect(viewFor("/", sources({ commands: { status: "ready", data: { commands: [], error: "Provider does not list commands" } } }))?.message).toEqual({
      text: NO_COMMANDS_TEXT,
      detail: "Provider does not list commands",
    });
    expect(viewFor("/x", sources({ commands: { status: "ready", data: { commands: [], error: null } } }))?.message).toEqual({
      text: NO_COMMANDS_TEXT,
      detail: null,
    });
  });

  it("shows a failed call's own sentence, never an empty line", () => {
    expect(viewFor("@", sources({ files: { status: "failed", message: "This agent is gone." } }))?.message).toEqual({
      text: "This agent is gone.",
      detail: null,
    });
    expect(viewFor("#", sources({ tickets: { status: "failed", message: "  " } }))?.message?.text).toBe("The list could not be read");
  });

  it("lists a folder's contents with its file count once a folder is typed", () => {
    const view = viewFor("look at @client/");
    expect(view?.folder).toBe("client/");
    expect(view?.fileCount).toBe(2);
    expect(view?.rows.map((row) => row.key)).toEqual(["file:client/agent-chat.tsx", "file:client/reply-box.tsx"]);
  });

  it("lists tickets matched on id or title", () => {
    expect(viewFor("#2")?.rows.map((row) => row.key)).toEqual(["ticket:TR-002"]);
    expect(viewFor("#comp")?.rows.map((row) => row.key)).toEqual(["ticket:TR-001"]);
  });
});

describe("activeTrigger", () => {
  it("follows no word while text is selected", () => {
    expect(activeTrigger("/co", null, null)).toBeNull();
  });

  it("keeps a word closed with Escape closed until it changes", () => {
    const trigger = findActiveTrigger("/co", 3);
    if (trigger === null) throw new Error("no trigger");
    const closed = triggerIdentity("/co", trigger);
    expect(activeTrigger("/co", 3, closed)).toBeNull();
    expect(activeTrigger("/co", 2, closed)).toBeNull();
    expect(activeTrigger("/com", 4, closed)?.query).toBe("com");
  });

  it("forgets the closed word once it changes or is gone, so typing it again opens the list", () => {
    const trigger = findActiveTrigger("/co", 3);
    if (trigger === null) throw new Error("no trigger");
    const closed = triggerIdentity("/co", trigger);
    expect(keptDismissal("/co", 3, closed)).toBe(closed);
    expect(keptDismissal("/co", null, closed)).toBe(closed);
    expect(keptDismissal("", 0, closed)).toBeNull();
    expect(keptDismissal("/com", 4, closed)).toBeNull();
    expect(keptDismissal("/co", 3, null)).toBeNull();
  });

  it("closes when the cursor leaves the word", () => {
    expect(activeTrigger("/co and more", 3, null)?.kind).toBe("command");
    expect(activeTrigger("/co and more", 7, null)).toBeNull();
  });
});

describe("selectedIndex", () => {
  it("starts at the first row", () => {
    expect(selectedIndex(null, "file", "", 5)).toBe(0);
  });

  it("goes back to the first row when the query or the list changes", () => {
    expect(selectedIndex({ kind: "file", query: "a", index: 3 }, "file", "ag", 5)).toBe(0);
    expect(selectedIndex({ kind: "file", query: "a", index: 3 }, "command", "a", 5)).toBe(0);
  });

  it("keeps the row for the same query, within the rows", () => {
    expect(selectedIndex({ kind: "file", query: "a", index: 3 }, "file", "a", 5)).toBe(3);
    expect(selectedIndex({ kind: "file", query: "a", index: 3 }, "file", "a", 2)).toBe(1);
    expect(selectedIndex({ kind: "file", query: "a", index: 3 }, "file", "a", 0)).toBe(0);
  });
});

describe("pickKeyAction", () => {
  const open = { shown: true, rows: 3 };

  it("moves, picks and closes while a list with rows is open", () => {
    expect(pickKeyAction({ key: "ArrowUp" }, open)).toBe("up");
    expect(pickKeyAction({ key: "ArrowDown" }, open)).toBe("down");
    expect(pickKeyAction({ key: "Enter" }, open)).toBe("pick");
    expect(pickKeyAction({ key: "Tab" }, open)).toBe("pick");
    expect(pickKeyAction({ key: "Escape" }, open)).toBe("close");
  });

  it("leaves every key to the box with no list: Enter sends and Escape stops the agent as before", () => {
    const none = { shown: false, rows: 0 };
    expect(pickKeyAction({ key: "Enter" }, none)).toBeNull();
    expect(pickKeyAction({ key: "Escape" }, none)).toBeNull();
    expect(pickKeyAction({ key: "ArrowUp" }, none)).toBeNull();
  });

  it("closes a list without rows on Escape, leaving Enter and the arrows to the box", () => {
    const empty = { shown: true, rows: 0 };
    expect(pickKeyAction({ key: "Escape" }, empty)).toBe("close");
    expect(pickKeyAction({ key: "Enter" }, empty)).toBeNull();
    expect(pickKeyAction({ key: "ArrowDown" }, empty)).toBeNull();
  });

  it("leaves Shift+Enter, typing and an input method's Enter to the box", () => {
    expect(pickKeyAction({ key: "Enter", shiftKey: true }, open)).toBeNull();
    expect(pickKeyAction({ key: "a" }, open)).toBeNull();
    expect(pickKeyAction({ key: "Enter", isComposing: true }, open)).toBeNull();
    expect(pickKeyAction({ key: "Enter", keyCode: 229 }, open)).toBeNull();
  });
});

describe("picking", () => {
  it("turns each kind of row into its pick", () => {
    const rows = viewFor("@")?.rows ?? [];
    const folder = rows.find((row) => row.kind === "file" && row.row.kind === "folder");
    if (folder === undefined) throw new Error("no folder row");
    expect(pickOf(folder)).toEqual({ kind: "folder", path: "client/" });
    const command = viewFor("/compact")?.rows[0];
    if (command === undefined) throw new Error("no command row");
    expect(pickOf(command)).toEqual({ kind: "command", name: "compact" });
    const ticket = viewFor("#1")?.rows[0];
    if (ticket === undefined) throw new Error("no ticket row");
    expect(pickOf(ticket)).toEqual({ kind: "ticket", id: "TR-001" });
  });

  it("keeps the text after the word and puts the cursor after the inserted space", () => {
    const text = "Look at @agch before you start";
    const view = viewFor(text, sources(), "Look at @agch".length);
    const row = view?.rows[0];
    if (view === null || view === undefined || row === undefined) throw new Error("no row");
    const result = applyPick(text, view.trigger, pickOf(row));
    expect(result.text).toBe("Look at @client/agent-chat.tsx before you start");
    expect(result.cursor).toBe("Look at @client/agent-chat.tsx ".length);
  });

  it("goes up a folder with the back arrow, to the opening list from the top", () => {
    expect(parentFolder("client/sub/")).toBe("client/");
    expect(parentFolder("client/")).toBe("");
    const trigger = findActiveTrigger("see @client/sub/ now", 16);
    if (trigger === null) throw new Error("no trigger");
    expect(browseTo("see @client/sub/ now", trigger, "client/")).toEqual({ text: "see @client/ now", cursor: 12 });
    expect(browseTo("see @client/sub/ now", trigger, "")).toEqual({ text: "see @ now", cursor: 5 });
  });
});

describe("row pieces", () => {
  it("marks the matched letters", () => {
    expect(markedPieces("compact", [0, 1])).toEqual([
      { text: "co", marked: true },
      { text: "mpact", marked: false },
    ]);
    expect(markedPieces("abc", [])).toEqual([{ text: "abc", marked: false }]);
  });

  it("splits a file into its name and folder, each with its own matched letters", () => {
    const parts = fileRowParts({ kind: "file", path: "client/agent-chat.tsx", hits: [0, 7, 8], tag: null, section: null }, false);
    expect(parts.name).toEqual([
      { text: "ag", marked: true },
      { text: "ent-chat.tsx", marked: false },
    ]);
    expect(parts.folder).toEqual([
      { text: "c", marked: true },
      { text: "lient/", marked: false },
    ]);
    expect(fileRowParts({ kind: "folder", path: "client/sub/", hits: [], tag: null, section: null }, true)).toEqual({
      name: [{ text: "sub/", marked: false }],
      folder: [],
    });
  });

  it("heads each section where it starts, the catch-all one only below another", () => {
    const withRecent = viewFor("/", sources({ recent: ["compact"] }))?.rows ?? [];
    expect(headingBefore(withRecent, 0)?.text).toBe("Used recently here");
    expect(headingBefore(withRecent, 1)?.text).toBe("All commands and skills");
    expect(headingBefore(withRecent, 2)).toBeNull();
    const plain = viewFor("/")?.rows ?? [];
    expect(headingBefore(plain, 0)).toBeNull();
    const files = viewFor("@")?.rows ?? [];
    expect(files.map((row, index) => headingBefore(files, index)?.text ?? null)).toEqual([
      "Changed on this branch",
      "Edited recently",
      "Top level",
      null,
      null,
    ]);
  });

  it("tones a ticket's status", () => {
    expect(ticketStatusTone("Done")).toBe("success");
    expect(ticketStatusTone("In Progress")).toBe("warning");
    expect(ticketStatusTone("Blocked")).toBe("danger");
    expect(ticketStatusTone("Planning")).toBe("muted");
  });
});

describe("scrollToShow", () => {
  it("scrolls only as far as brings the selected row into view", () => {
    expect(scrollToShow(0, 200, 40, 34)).toBe(0);
    expect(scrollToShow(0, 200, 250, 34)).toBe(84);
    expect(scrollToShow(100, 200, 40, 34)).toBe(40);
    expect(scrollToShow(30, 0, 400, 34)).toBe(30);
  });
});

describe("createCursorStore", () => {
  it("tells its listeners of a move, once per change", () => {
    const store = createCursorStore();
    const heard: (number | null)[] = [];
    const stop = store.subscribe(() => heard.push(store.get()));
    store.set(3);
    store.set(3);
    store.set(null);
    stop();
    store.set(5);
    expect(heard).toEqual([3, null]);
    expect(store.get()).toBe(5);
  });
});
