import { describe, expect, it } from "vitest";

import {
  applyPick,
  findActiveTrigger,
  moveSelection,
  pickListKey,
  rankCommands,
  rankFiles,
  rankTickets,
  rememberCommand,
  type ActiveTrigger,
  type AgentCommand,
  type FileIndex,
  type TicketSummary,
} from "./composer-picks";

/** The trigger with the cursor where `|` is in `marked`. */
function triggerAt(marked: string): ActiveTrigger | null {
  const cursor = marked.indexOf("|");
  return findActiveTrigger(marked.replace("|", ""), cursor);
}

describe("findActiveTrigger", () => {
  it("finds nothing in empty text or text without a trigger", () => {
    expect(findActiveTrigger("", 0)).toBeNull();
    expect(triggerAt("hello|")).toBeNull();
  });

  it("opens on a trigger alone", () => {
    expect(triggerAt("/|")).toEqual({ kind: "command", start: 0, end: 1, query: "", atStart: true });
    expect(triggerAt("@|")).toEqual({ kind: "file", start: 0, end: 1, query: "", atStart: true });
    expect(triggerAt("#|")).toEqual({ kind: "ticket", start: 0, end: 1, query: "", atStart: true });
  });

  it("opens at the start, middle and end of the text", () => {
    expect(triggerAt("/comp| later")).toEqual({ kind: "command", start: 0, end: 5, query: "comp", atStart: true });
    expect(triggerAt("Look at @agchat| before")).toEqual({ kind: "file", start: 8, end: 15, query: "agchat", atStart: false });
    expect(triggerAt("This overlaps #comp|")).toEqual({ kind: "ticket", start: 14, end: 19, query: "comp", atStart: false });
  });

  it("is at the start after leading whitespace only", () => {
    expect(triggerAt("  \n/re|")?.atStart).toBe(true);
    expect(triggerAt("x /re|")?.atStart).toBe(false);
  });

  it("opens after a line break in multi-line text", () => {
    expect(triggerAt("first line\n@cli|ent\nthird")).toEqual({ kind: "file", start: 11, end: 18, query: "cli", atStart: false });
  });

  it("covers the whole word when the cursor is mid-word", () => {
    expect(triggerAt("see @cl|ient/x.ts now")).toEqual({ kind: "file", start: 4, end: 16, query: "cl", atStart: false });
  });

  it("finds nothing with the cursor before the trigger or outside the word", () => {
    expect(triggerAt("|@client")).toBeNull();
    expect(triggerAt("@client |")).toBeNull();
    expect(triggerAt("a |b @client")).toBeNull();
  });

  it("does not open inside a word: an address, C#, a/b", () => {
    expect(triggerAt("alex@example.com|")).toBeNull();
    expect(triggerAt("alex@ex|")).toBeNull();
    expect(triggerAt("in C#|")).toBeNull();
    expect(triggerAt("a/b|")).toBeNull();
  });

  it("ends at whitespace or a quote before the cursor", () => {
    expect(triggerAt("@a b|")).toBeNull();
    expect(triggerAt('@"a|')).toBeNull();
    expect(triggerAt("#it's|")).toBeNull();
  });

  it("treats a word with a second slash as a path, not a command", () => {
    expect(triggerAt("/tmp/x|")).toBeNull();
    expect(triggerAt("/tm|p/x")).toBeNull();
    expect(triggerAt("see /tmp/|")).toBeNull();
  });

  it("lets files and tickets use slashes, dots and dashes", () => {
    expect(triggerAt("@client/sub/a-b.ts|")?.query).toBe("client/sub/a-b.ts");
    expect(triggerAt("#TR-23|")?.query).toBe("TR-23");
  });

  it("clamps the cursor to the text", () => {
    expect(findActiveTrigger("@ab", 99)).toEqual({ kind: "file", start: 0, end: 3, query: "ab", atStart: true });
    expect(findActiveTrigger("@ab", -5)).toBeNull();
  });
});

function command(name: string): AgentCommand {
  return { name, description: `${name} description`, argumentHint: "" };
}

const commands = ["review", "compact", "code-review", "cost", "context", "init", "pr-comments"].map(command);

function names(rows: readonly { command: AgentCommand }[]): string[] {
  return rows.map((row) => row.command.name);
}

describe("rankCommands", () => {
  it("lists recent commands first, then every other alphabetically", () => {
    const rows = rankCommands(commands, "", ["init", "cost"]);
    expect(names(rows)).toEqual(["init", "cost", "code-review", "compact", "context", "pr-comments", "review"]);
    expect(rows.map((row) => row.section)).toEqual(["recent", "recent", "all", "all", "all", "all", "all"]);
    expect(rows.every((row) => row.hits.length === 0)).toBe(true);
  });

  it("ignores a recent name the agent no longer has", () => {
    const rows = rankCommands(commands, "", ["gone", "cost"]);
    expect(names(rows).slice(0, 2)).toEqual(["cost", "code-review"]);
    expect(rows[0]?.section).toBe("recent");
    expect(rows[1]?.section).toBe("all");
  });

  it("ranks co: compact, context and cost above code-review", () => {
    const rows = rankCommands(commands, "co", []);
    const order = names(rows);
    expect(order.indexOf("code-review")).toBe(3);
    expect(order.slice(0, 3).sort()).toEqual(["compact", "context", "cost"]);
    expect(rows.every((row) => row.section === null)).toBe(true);
    expect(rows[0]?.hits).toEqual([0, 1]);
  });

  it("puts a prefix before a word start, a word start before contiguous, contiguous before scattered", () => {
    const list = ["rxexvxixexw", "xreview", "pre-review", "review-all"].map(command);
    expect(names(rankCommands(list, "review", []))).toEqual(["review-all", "pre-review", "xreview", "rxexvxixexw"]);
  });

  it("matches word starts ahead of other contiguous runs", () => {
    const list = ["acomments", "pr-comments"].map(command);
    const rows = rankCommands(list, "comm", []);
    expect(names(rows)).toEqual(["pr-comments", "acomments"]);
    expect(rows[0]?.hits).toEqual([3, 4, 5, 6]);
  });

  it("matches scattered letters in order, ignoring case", () => {
    const rows = rankCommands(commands, "PRC", []);
    expect(names(rows)).toEqual(["pr-comments"]);
    expect(rows[0]?.hits).toEqual([0, 1, 3]);
  });

  it("returns nothing when no command matches", () => {
    expect(rankCommands(commands, "zz", ["cost"])).toEqual([]);
  });
});

describe("rememberCommand", () => {
  it("puts the name first, drops its older copy and keeps at most max", () => {
    expect(rememberCommand(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(rememberCommand([], "a")).toEqual(["a"]);
    expect(rememberCommand(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
    expect(rememberCommand(["1", "2", "3", "4", "5", "6", "7", "8"], "9")).toEqual(["9", "1", "2", "3", "4", "5", "6", "7"]);
  });
});

const files = [
  "README.md",
  "package.json",
  "client/agent-chat.tsx",
  "client/agent-chips.tsx",
  "client/sub/deep.ts",
  "client/sub/more/deeper.ts",
  "client/zeta.ts",
  "server/agent/chat-queue.ts",
  "server/index.ts",
  "shared/agent-trim.ts",
  "docs/my notes.md",
];

function fileIndex(overrides: Partial<FileIndex> = {}): FileIndex {
  return { files, changed: [], recent: [], truncated: false, ...overrides };
}

describe("rankFiles with an empty query", () => {
  it("lists changed files, then recent ones, then the top level, folders first", () => {
    const list = rankFiles(
      fileIndex({ changed: [{ path: "client/zeta.ts", status: "changed" }, { path: "server/new.ts", status: "new" }], recent: ["server/index.ts", "client/zeta.ts"] }),
      "",
    );
    expect(list.folder).toBeNull();
    expect(list.fileCount).toBeNull();
    expect(list.rows).toEqual([
      { kind: "file", path: "client/zeta.ts", hits: [], tag: "changed", section: "changed" },
      { kind: "file", path: "server/new.ts", hits: [], tag: "new", section: "changed" },
      { kind: "file", path: "server/index.ts", hits: [], tag: null, section: "recent" },
      { kind: "folder", path: "client/", hits: [], tag: null, section: "top" },
      { kind: "folder", path: "docs/", hits: [], tag: null, section: "top" },
      { kind: "folder", path: "server/", hits: [], tag: null, section: "top" },
      { kind: "folder", path: "shared/", hits: [], tag: null, section: "top" },
      { kind: "file", path: "package.json", hits: [], tag: null, section: "top" },
      { kind: "file", path: "README.md", hits: [], tag: null, section: "top" },
    ]);
  });

  it("does not repeat a top-level file already shown, and caps at the limit", () => {
    const list = rankFiles(fileIndex({ recent: ["README.md"] }), "", 3);
    expect(list.rows.map((row) => row.path)).toEqual(["README.md", "client/", "docs/"]);
    expect(rankFiles(fileIndex({ recent: ["README.md"] }), "").rows.filter((row) => row.path === "README.md")).toHaveLength(1);
  });
});

describe("rankFiles browsing a folder", () => {
  it("lists a folder's sub-folders then files, with its file count and changed tags", () => {
    const list = rankFiles(fileIndex({ changed: [{ path: "client/agent-chat.tsx", status: "changed" }] }), "client/");
    expect(list.folder).toBe("client/");
    expect(list.fileCount).toBe(5);
    expect(list.rows).toEqual([
      { kind: "folder", path: "client/sub/", hits: [], tag: null, section: null },
      { kind: "file", path: "client/agent-chat.tsx", hits: [], tag: "changed", section: null },
      { kind: "file", path: "client/agent-chips.tsx", hits: [], tag: null, section: null },
      { kind: "file", path: "client/zeta.ts", hits: [], tag: null, section: null },
    ]);
  });

  it("browses a nested folder", () => {
    const list = rankFiles(fileIndex(), "client/sub/");
    expect(list.folder).toBe("client/sub/");
    expect(list.fileCount).toBe(2);
    expect(list.rows.map((row) => [row.kind, row.path])).toEqual([
      ["folder", "client/sub/more/"],
      ["file", "client/sub/deep.ts"],
    ]);
  });

  it("falls back to matching when a trailing-slash query is not a folder", () => {
    const list = rankFiles(fileIndex(), "cli/");
    expect(list.folder).toBeNull();
    expect(list.rows[0]?.path).toBe("client/");
    expect(list.rows[0]?.hits).toEqual([0, 1, 2, 6]);
  });
});

describe("rankFiles with a query", () => {
  it("weights the file name: agchat finds client/agent-chat.tsx before server/agent/chat-queue.ts", () => {
    const list = rankFiles(fileIndex(), "agchat");
    const paths = list.rows.map((row) => row.path);
    expect(paths[0]).toBe("client/agent-chat.tsx");
    expect(paths.indexOf("client/agent-chat.tsx")).toBeLessThan(paths.indexOf("server/agent/chat-queue.ts"));
    expect(list.rows[0]).toEqual({ kind: "file", path: "client/agent-chat.tsx", hits: [7, 8, 13, 14, 15, 16], tag: null, section: null });
  });

  it("matches across folders with a slash in the query", () => {
    const list = rankFiles(fileIndex(), "cli/chat");
    expect(list.rows[0]?.path).toBe("client/agent-chat.tsx");
    expect(list.rows[0]?.hits).toEqual([0, 1, 2, 6, 13, 14, 15, 16]);
  });

  it("ignores case and lists folders it matches", () => {
    const list = rankFiles(fileIndex(), "SUBMORE");
    expect(list.rows.map((row) => [row.kind, row.path])).toEqual([
      ["folder", "client/sub/more/"],
      ["file", "client/sub/more/deeper.ts"],
    ]);
  });

  it("prefers word starts and shorter paths, and boosts a changed file", () => {
    const pair = ["lib/mate.ts", "lib/xmate.ts"];
    expect(rankFiles(fileIndex({ files: pair }), "mate").rows.map((row) => row.path)).toEqual(["lib/mate.ts", "lib/xmate.ts"]);
    const lengths = ["a/index.ts", "a/b/index.ts"];
    expect(rankFiles(fileIndex({ files: lengths }), "index").rows.map((row) => row.path)).toEqual(["a/index.ts", "a/b/index.ts"]);
    const changed = rankFiles(fileIndex({ files: lengths, changed: [{ path: "a/b/index.ts", status: "new" }] }), "index");
    expect(changed.rows[0]).toMatchObject({ path: "a/b/index.ts", tag: "new" });
  });

  it("breaks ties alphabetically", () => {
    expect(rankFiles(fileIndex({ files: ["b.ts", "a.ts"] }), "ts").rows.map((row) => row.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("returns no rows when nothing matches, and caps at the limit", () => {
    expect(rankFiles(fileIndex(), "qqq").rows).toEqual([]);
    expect(rankFiles(fileIndex(), "t", 2).rows).toHaveLength(2);
  });

  it("ranks 20,000 paths for a 6-letter query in under 50 ms (median of 5)", () => {
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const words = ["agent", "chat", "client", "server", "shared", "queue", "board", "ticket", "store", "view", "card", "test", "util", "hook", "panel"];
    const word = (): string => words[Math.floor(random() * words.length)] ?? "x";
    const paths: string[] = [];
    for (let index = 0; index < 20000; index += 1) {
      const depth = 1 + Math.floor(random() * 4);
      const folders = Array.from({ length: depth }, () => word()).join("/");
      paths.push(`${folders}/${word()}-${word()}-${index}.ts`);
    }
    const timings: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      // A fresh array each run, so the folder list is worked out again and counted too.
      const index = fileIndex({ files: [...paths] });
      const started = performance.now();
      const list = rankFiles(index, "agchat");
      timings.push(performance.now() - started);
      expect(list.rows.length).toBeGreaterThan(0);
    }
    const median = [...timings].sort((left, right) => left - right)[2] ?? Infinity;
    console.log(`rankFiles, 20,000 paths, "agchat": median ${median.toFixed(1)} ms of ${timings.map((time) => time.toFixed(1)).join(", ")}`);
    expect(median).toBeLessThan(50);
  });
});

const tickets: TicketSummary[] = [
  { id: "TR-39", title: "Composer takes Paseo's layout", status: "Done" },
  { id: "TR-232", title: "Chat composer: slash commands and file tagging", status: "Planning" },
  { id: "TR-171", title: "Composer queue: hold messages", status: "Done" },
  { id: "TR-231", title: "Send now from a queued composer message", status: "In Progress" },
  { id: "TR-23", title: "Board paging", status: "Cancelled" },
  { id: "TR-007", title: "Early work", status: "To Do" },
];

function ids(rows: readonly { ticket: TicketSummary }[]): string[] {
  return rows.map((row) => row.ticket.id);
}

describe("rankTickets", () => {
  it("lists open tickets first, then closed ones, each newest first", () => {
    expect(ids(rankTickets(tickets, ""))).toEqual(["TR-232", "TR-231", "TR-007", "TR-171", "TR-39", "TR-23"]);
    expect(ids(rankTickets(tickets, "", 2))).toEqual(["TR-232", "TR-231"]);
  });

  it("matches the number alone, ignoring the prefix", () => {
    const rows = rankTickets(tickets, "232");
    expect(ids(rows)).toEqual(["TR-232"]);
    expect(rows[0]?.hits).toEqual([3, 4, 5]);
    expect(ids(rankTickets(tickets, "23"))).toEqual(["TR-23", "TR-232", "TR-231"]);
    expect(rankTickets(tickets, "7")[0]).toEqual({ ticket: tickets[5], hits: [5], titleHits: [] });
  });

  it("matches the id from its start ignoring case and the dash", () => {
    expect(ids(rankTickets(tickets, "tr-23"))).toEqual(["TR-23", "TR-232", "TR-231"]);
    const rows = rankTickets(tickets, "TR232");
    expect(ids(rows)).toEqual(["TR-232"]);
    expect(rows[0]?.hits).toEqual([0, 1, 3, 4, 5]);
  });

  it("matches the title fuzzily, word starts first, after id matches", () => {
    const rows = rankTickets(tickets, "comp");
    expect(ids(rows).slice(0, 4).sort()).toEqual(["TR-171", "TR-231", "TR-232", "TR-39"]);
    // Each puts `comp` at a word start, so the newest leads.
    expect(rows[0]).toEqual({ ticket: tickets[1], hits: [], titleHits: [5, 6, 7, 8] });
    const paging = rankTickets(tickets, "bp");
    expect(paging[0]).toEqual({ ticket: tickets[4], hits: [], titleHits: [0, 6] });
  });

  it("puts id matches before title matches", () => {
    const list: TicketSummary[] = [
      { id: "TR-5", title: "About TR-12", status: "To Do" },
      { id: "TR-12", title: "Other", status: "To Do" },
    ];
    expect(ids(rankTickets(list, "12"))).toEqual(["TR-12", "TR-5"]);
    expect(ids(rankTickets(list, "tr12"))).toEqual(["TR-12", "TR-5"]);
  });

  it("returns nothing without a match and caps at the limit", () => {
    expect(rankTickets(tickets, "zzz")).toEqual([]);
    expect(rankTickets(tickets, "tr", 3)).toHaveLength(3);
  });
});

/** The text and cursor after a pick, the cursor drawn as `|`. */
function picked(marked: string, pick: Parameters<typeof applyPick>[2]): string {
  const text = marked.replace("|", "");
  const trigger = findActiveTrigger(text, marked.indexOf("|"));
  if (trigger === null) throw new Error(`no trigger in ${marked}`);
  const result = applyPick(text, trigger, pick);
  return `${result.text.slice(0, result.cursor)}|${result.text.slice(result.cursor)}`;
}

describe("applyPick", () => {
  it("inserts a command at the start with one space after", () => {
    expect(picked("/comp|", { kind: "command", name: "compact" })).toBe("/compact |");
  });

  it("inserts a file mid-text, keeping the text after it", () => {
    expect(picked("Look at @agchat| before you start", { kind: "file", path: "client/agent-chat.tsx" })).toBe("Look at @client/agent-chat.tsx |before you start");
  });

  it("inserts at the end of the text", () => {
    expect(picked("This overlaps #comp|", { kind: "ticket", id: "TR-232" })).toBe("This overlaps TR-232 |");
  });

  it("quotes a path with a space", () => {
    expect(picked("@notes|", { kind: "file", path: "docs/my notes.md" })).toBe('@"docs/my notes.md" |');
  });

  it("opens a folder with the cursor straight after it and no space", () => {
    expect(picked("see @cli| now", { kind: "folder", path: "client/" })).toBe("see @client/| now");
    expect(picked("@cli|", { kind: "folder", path: "client" })).toBe("@client/|");
  });

  it("replaces the whole word when the cursor is mid-word", () => {
    expect(picked("a @ag|chat b", { kind: "file", path: "client/agent-chat.tsx" })).toBe("a @client/agent-chat.tsx |b");
    expect(picked("/co|mp\nnext", { kind: "command", name: "compact" })).toBe("/compact\n|next");
  });
});

describe("pickListKey", () => {
  it("maps the list's keys and leaves the rest to the text field", () => {
    expect(pickListKey("ArrowUp", false)).toBe("up");
    expect(pickListKey("ArrowDown", false)).toBe("down");
    expect(pickListKey("Enter", false)).toBe("pick");
    expect(pickListKey("Tab", false)).toBe("pick");
    expect(pickListKey("Escape", false)).toBe("close");
    expect(pickListKey("Enter", true)).toBeNull();
    expect(pickListKey("Tab", true)).toBeNull();
    expect(pickListKey("a", false)).toBeNull();
  });
});

describe("moveSelection", () => {
  it("wraps round both ends", () => {
    expect(moveSelection(0, 3, "down")).toBe(1);
    expect(moveSelection(2, 3, "down")).toBe(0);
    expect(moveSelection(0, 3, "up")).toBe(2);
    expect(moveSelection(1, 3, "up")).toBe(0);
  });

  it("stays at 0 for an empty list", () => {
    expect(moveSelection(0, 0, "down")).toBe(0);
    expect(moveSelection(4, 0, "up")).toBe(0);
  });
});
