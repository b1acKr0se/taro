import { describe, expect, it } from "vitest";

import { midTurnMessages, quotedForReminder, quotes, quotesMessage, turnEntries, unansweredMessages, type MidTurnEntry, type MidTurnItem } from "./mid-turn";

const user = (text: string, clientMessageId?: string): MidTurnItem => ({ type: "user_message", text, ...(clientMessageId === undefined ? {} : { clientMessageId }) });
const said = (text: string): MidTurnItem => ({ type: "assistant_message", text });
const tool: MidTurnItem = { type: "tool_call" };
const notPlugin = (item: MidTurnItem): boolean => !(item.clientMessageId ?? "").startsWith("taro-");

const QUESTION = "Would we need to migrate old pause tickets?";

describe("turnEntries", () => {
  it("takes the run of the turn's id at the end of the page", () => {
    const entries: MidTurnEntry[] = [
      { item: user("Say ok."), turnId: "foreground-turn-1" },
      { item: said("ok"), turnId: "foreground-turn-1" },
      { item: user("Run the tests."), turnId: "foreground-turn-2" },
      { item: tool, turnId: "foreground-turn-2" },
    ];
    expect(turnEntries(entries, "foreground-turn-2")).toEqual({ entries: entries.slice(2), complete: true });
  });

  it("is incomplete when the turn fills the page, and empty for another turn's id", () => {
    const entries: MidTurnEntry[] = [{ item: tool, turnId: "t" }];
    expect(turnEntries(entries, "t")).toEqual({ entries, complete: false });
    expect(turnEntries(entries, "other")).toEqual({ entries: [], complete: true });
    expect(turnEntries([], "t")).toEqual({ entries: [], complete: false });
  });

  it("ignores an earlier session's turn with the same id when another turn lies between", () => {
    const entries: MidTurnEntry[] = [
      { item: user("Old"), turnId: "foreground-turn-1" },
      { item: said("done"), turnId: "foreground-turn-9" },
      { item: user("New"), turnId: "foreground-turn-1" },
    ];
    expect(turnEntries(entries, "foreground-turn-1").entries).toEqual([entries[2]]);
  });
});

describe("midTurnMessages", () => {
  it("finds the user's messages after the turn's opening, not the opening itself", () => {
    const turn: MidTurnEntry[] = [{ item: user("Plan TR-166") }, { item: tool }, { item: user(QUESTION, "chat-1") }, { item: tool }];
    expect(midTurnMessages(turn, notPlugin)).toEqual([user(QUESTION, "chat-1")]);
  });

  it("leaves out the plugin's own messages and a turn with only its opening", () => {
    expect(midTurnMessages([{ item: user("Plan") }, { item: user("A report", "taro-1") }], notPlugin)).toEqual([]);
    expect(midTurnMessages([{ item: user("Plan") }], notPlugin)).toEqual([]);
    expect(midTurnMessages([], notPlugin)).toEqual([]);
  });

  it("finds several in order", () => {
    const turn: MidTurnEntry[] = [{ item: user("Plan") }, { item: user("First?") }, { item: tool }, { item: user("Second?") }];
    expect(midTurnMessages(turn, notPlugin).map((item) => item.text)).toEqual(["First?", "Second?"]);
  });
});

describe("quotes", () => {
  it("joins consecutive quote lines and keeps separate quotes apart", () => {
    expect(quotes("> one\n> two\ntext\n>three\n\n  > four")).toEqual(["one two", "three", "four"]);
    expect(quotes("no quote here")).toEqual([]);
    expect(quotes("")).toEqual([]);
  });
});

describe("quotesMessage", () => {
  it("accepts the whole message quoted, whatever its case and punctuation", () => {
    expect(quotesMessage(`> would we need to migrate old pause tickets\n\nNo: …`, QUESTION)).toBe(true);
  });

  it("accepts a long enough piece, with an ellipsis", () => {
    expect(quotesMessage("> Would we need to migrate…\n\nNo.", QUESTION)).toBe(true);
  });

  it("refuses a piece too short, words not in the message, or no quote", () => {
    expect(quotesMessage("> Would we\n\nNo.", QUESTION)).toBe(false);
    expect(quotesMessage("> Would we need to move the old tickets?\n\nNo.", QUESTION)).toBe(false);
    expect(quotesMessage("Would we need to migrate old pause tickets? No.", QUESTION)).toBe(false);
    expect(quotesMessage(">\n> ...", QUESTION)).toBe(false);
  });

  it("takes a short message only whole, and an empty one as answered", () => {
    expect(quotesMessage("> Why?\n\nBecause.", "Why?")).toBe(true);
    expect(quotesMessage("> Why\n\nBecause.", "Why not?")).toBe(false);
    expect(quotesMessage("anything", "  ?! ")).toBe(true);
  });

  it("matches a multi-line message quoted over several lines", () => {
    expect(quotesMessage("> Two things: the label\n> and the colour of the card", "Two things: the label\nand the colour of the card.\nThanks")).toBe(true);
  });
});

describe("unansweredMessages", () => {
  it("is empty when a reply after the message quotes it", () => {
    const timeline = [user("Plan"), tool, user(QUESTION, "chat-1"), tool, said(`> ${QUESTION}\n\nNo migration needed.\n\nwaiting: approval`)];
    expect(unansweredMessages(timeline, [user(QUESTION, "chat-1")])).toEqual([]);
  });

  it("reports the TR-166 case: replies after it never quote it", () => {
    const timeline = [user("Plan"), tool, user(QUESTION, "chat-1"), tool, said("Plan written.\n\nwaiting: approval")];
    expect(unansweredMessages(timeline, [user(QUESTION, "chat-1")])).toEqual([QUESTION]);
  });

  it("does not count a quote written before the message arrived", () => {
    const timeline = [user("Plan"), said(`> ${QUESTION}`), user(QUESTION, "chat-1"), said("done: plan")];
    expect(unansweredMessages(timeline, [user(QUESTION, "chat-1")])).toEqual([QUESTION]);
  });

  it("finds a quote opening a message after narration and a tool call (the noted-then-answered shape)", () => {
    const timeline = [user("Plan"), user(QUESTION, "chat-1"), said("Noted, I'll answer after the schema check."), tool, said(`> ${QUESTION}\n\nNo.\n\nwaiting: approval`)];
    expect(unansweredMessages(timeline, [user(QUESTION, "chat-1")])).toEqual([]);
  });

  it("finds a quote split over streamed pieces", () => {
    const timeline = [user("Plan"), user(QUESTION), said("> Would we need to "), said("migrate old pause tickets?\n\nNo.")];
    expect(unansweredMessages(timeline, [user(QUESTION)])).toEqual([]);
  });

  it("finds a message without a client id by its last place, and leaves out one not in the timeline", () => {
    const timeline = [user(QUESTION), said(`> ${QUESTION}\n\nNo.`), user("Plan"), user(QUESTION), said("waiting: approval")];
    expect(unansweredMessages(timeline, [user(QUESTION)])).toEqual([QUESTION]);
    expect(unansweredMessages([user("Plan"), said("ok")], [user(QUESTION, "chat-9")])).toEqual([]);
  });

  it("checks each message on its own", () => {
    const timeline = [user("Plan"), user("Is the label final?", "chat-1"), user("And the colour of it?", "chat-2"), said("> Is the label final?\n\nYes.")];
    expect(unansweredMessages(timeline, [user("Is the label final?", "chat-1"), user("And the colour of it?", "chat-2")])).toEqual(["And the colour of it?"]);
  });
});

describe("quotedForReminder", () => {
  it("quotes each line of each message, the messages apart", () => {
    expect(quotedForReminder(["One?", "Two\n\nlines"])).toBe("> One?\n\n> Two\n>\n> lines");
  });
});
