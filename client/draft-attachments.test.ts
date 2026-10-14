import { describe, expect, it } from "vitest";

import type { DraftAttachment } from "../shared/attachments";
import { createAttachmentDraftStore } from "./draft-attachments";

const image: DraftAttachment = { id: "1", kind: "image", fileName: "a.png", mimeType: "image/png", data: "AA==" };
const file: DraftAttachment = { id: "2", kind: "file", fileName: "b.txt", mimeType: "text/plain", data: "Ag==" };

describe("createAttachmentDraftStore", () => {
  it("keeps each agent's attachments apart, and none by default", () => {
    const store = createAttachmentDraftStore({});
    expect(store.get("agent-1")).toEqual([]);
    store.set("agent-1", [image, file]);
    expect(store.get("agent-1")).toEqual([image, file]);
    expect(store.get("agent-2")).toEqual([]);
  });

  it("outlasts a fresh evaluation of the bundle on the same global object", () => {
    const root = {};
    createAttachmentDraftStore(root).set("agent-1", [image]);
    expect(createAttachmentDraftStore(root).get("agent-1")).toEqual([image]);
    expect(createAttachmentDraftStore({}).get("agent-1")).toEqual([]);
  });

  it("forgets an emptied list and tells its listeners of every change", () => {
    const store = createAttachmentDraftStore({});
    let heard = 0;
    const stop = store.subscribe(() => (heard += 1));
    store.set("agent-1", [image]);
    store.set("agent-1", []);
    expect(store.get("agent-1")).toEqual([]);
    expect(heard).toBe(2);
    stop();
    store.set("agent-1", [file]);
    expect(heard).toBe(2);
  });
});
