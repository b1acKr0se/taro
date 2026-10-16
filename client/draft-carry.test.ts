import { describe, expect, it } from "vitest";

import type { DraftAttachment } from "../shared/attachments";
import { createAttachmentDraftStore } from "./draft-attachments";
import { carryDraft } from "./draft-carry";
import { createDraftStore } from "./draft";

const image: DraftAttachment = { id: "1", kind: "image", fileName: "a.png", mimeType: "image/png", data: "AA==" };
const file: DraftAttachment = { id: "2", kind: "file", fileName: "b.txt", mimeType: "text/plain", data: "Ag==" };

function stores() {
  return { text: createDraftStore({}), attachments: createAttachmentDraftStore({}) };
}

describe("carryDraft", () => {
  it("moves the words and attachments to the new agent and empties the old box", () => {
    const kept = stores();
    kept.text.set("old", "File a ticket for the login bug");
    kept.attachments.set("old", [image]);
    carryDraft(kept, "old", "new");
    expect(kept.text.get("new")).toBe("File a ticket for the login bug");
    expect(kept.attachments.get("new")).toEqual([image]);
    expect(kept.text.get("old")).toBe("");
    expect(kept.attachments.get("old")).toEqual([]);
  });

  it("keeps what the new box already holds ahead of what it carries", () => {
    const kept = stores();
    kept.text.set("old", "second");
    kept.attachments.set("old", [file]);
    kept.text.set("new", "first");
    kept.attachments.set("new", [image]);
    carryDraft(kept, "old", "new");
    expect(kept.text.get("new")).toBe("first\n\nsecond");
    expect(kept.attachments.get("new")).toEqual([image, file]);
  });

  it("leaves the new box alone when there is nothing to carry", () => {
    const kept = stores();
    kept.text.set("new", "already here");
    carryDraft(kept, "old", "new");
    expect(kept.text.get("new")).toBe("already here");
    expect(kept.attachments.get("new")).toEqual([]);
  });

  it("does nothing when both are the same agent", () => {
    const kept = stores();
    kept.text.set("same", "kept");
    kept.attachments.set("same", [image]);
    carryDraft(kept, "same", "same");
    expect(kept.text.get("same")).toBe("kept");
    expect(kept.attachments.get("same")).toEqual([image]);
  });
});
