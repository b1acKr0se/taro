import { describe, expect, it } from "vitest";

import { answerWords, severalAnswers } from "./decision-answers";
import type { DecisionQuestion } from "./reports";

const question = (header: string, options: [string, string][]): DecisionQuestion => ({
  header,
  question: `${header}?`,
  why: "",
  options: options.map(([label, prompt]) => ({ label, prompt, consequence: "", images: [] })),
  recommended: options[0]?.[0] ?? "",
  reason: "",
});

const QUESTIONS = [
  question("Tags", [["YAML", "Use YAML"], ["Hashtags", "Use a hashtag line"]]),
  question("Folders", [["Flat", "One folder"], ["Nested", "Notebooks as folders"]]),
  question("Images", [["Copy", "Copy beside each note"], ["Link…", "Link them…"]]),
];

describe("severalAnswers (TR-207)", () => {
  it("three answers make three lines in order", () => {
    const sent = severalAnswers(QUESTIONS, [
      { header: "Images", label: null, text: "keep them out" },
      { header: "Tags", label: "YAML", text: "" },
      { header: "Folders", label: "Flat", text: "" },
    ]);
    expect(sent.message).toBe('Tags: Use YAML\nFolders: One folder\nImages: "keep them out"');
    expect(sent.answers.map((answer) => answer.header)).toEqual(["Tags", "Folders", "Images"]);
  });

  it("typed words are quoted", () => {
    const sent = severalAnswers(QUESTIONS.slice(0, 2), [
      { header: "Tags", label: "YAML", text: "" },
      { header: "Folders", label: null, text: "  one folder per notebook, flat inside " },
    ]);
    expect(sent.message).toBe('Tags: Use YAML\nFolders: "one folder per notebook, flat inside"');
  });

  it("an option that asks for words sends its prompt and the words, unquoted", () => {
    const sent = severalAnswers(QUESTIONS.slice(1), [
      { header: "Folders", label: "Nested", text: "" },
      { header: "Images", label: "Link…", text: "to the CDN" },
    ]);
    expect(sent.message).toBe("Folders: Notebooks as folders\nImages: Link them: to the CDN");
  });

  it("fewer answers than questions is refused", () => {
    expect(() => severalAnswers(QUESTIONS, [{ header: "Tags", label: "YAML", text: "" }])).toThrow(/1 of 3 answered/);
    expect(() => severalAnswers(QUESTIONS.slice(0, 1), [{ header: "Tags", label: null, text: "  " }])).toThrow(/Type an answer/);
  });

  it("two questions with the same header each get their own answer, by position", () => {
    const twice = [question("Tags", [["YAML", "Use YAML"]]), question("Tags", [["Hashtags", "Use a hashtag line"]])];
    const sent = severalAnswers(twice, [
      { header: "Tags", label: "YAML", text: "" },
      { header: "Tags", label: "Hashtags", text: "" },
    ]);
    expect(sent.message).toBe("Tags: Use YAML\nTags: Use a hashtag line");
    expect(() => severalAnswers(twice, [{ header: "Tags", label: "YAML", text: "" }])).toThrow(/1 of 2 answered/);
  });

  it("the record lists each header, label or Other, and words", () => {
    const sent = severalAnswers(QUESTIONS.slice(0, 2), [
      { header: "Tags", label: "YAML", text: "" },
      { header: "Folders", label: null, text: "one folder per notebook" },
    ]);
    expect(sent.record).toBe('Tags: YAML ("Use YAML"); Folders: Other ("one folder per notebook")');
  });
});

describe("answerWords", () => {
  it("joins words to a prompt that asks for them, and does not repeat the prompt", () => {
    expect(answerWords({ prompt: "Change the proposal…" }, "use cards B")).toBe("Change the proposal: use cards B");
    expect(answerWords({ prompt: "Approve" }, "Approve")).toBe("Approve");
    expect(answerWords(null, " mine ")).toBe("mine");
  });
});
