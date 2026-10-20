import { describe, expect, it } from "vitest";
import { senderPillColours } from "./sender-pill";

const colours = (surface0: string, foreground: string) => ({ surface0, foreground, border: "BORDER", foregroundMuted: "MUTED" }) as Parameters<typeof senderPillColours>[0];

describe("senderPillColours", () => {
  it("uses the border colour and the text colour on a light theme", () => {
    expect(senderPillColours(colours("#ffffff", "#18181b"))).toEqual({ background: "BORDER", text: colours("", "#18181b").foreground });
  });

  it("uses the page background and muted text on a dark theme, in hex or rgb", () => {
    expect(senderPillColours(colours("#18181b", "#fafafa"))).toEqual({ background: "#18181b", text: "MUTED" });
    expect(senderPillColours(colours("rgb(24, 24, 27)", "rgba(250,250,250,1)"))).toEqual({ background: "rgb(24, 24, 27)", text: "MUTED" });
  });

  it("treats a colour it cannot read as light", () => {
    expect(senderPillColours(colours("var(--page)", "#fafafa")).background).toBe("BORDER");
  });
});
