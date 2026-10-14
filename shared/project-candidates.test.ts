import { describe, expect, it } from "vitest";

import {
  candidateDraft,
  filterCandidates,
  remoteLabel,
  settingsSummary,
  sortCandidates,
  suggestProjectName,
  suggestTicketPrefix,
  type PaseoProjectCandidate,
  type SettingsTemplate,
} from "./project-candidates";
import { setupProblems } from "./setup-form";

function candidate(name: string, overrides: Partial<PaseoProjectCandidate> = {}): PaseoProjectCandidate {
  return {
    paseoProjectId: `prj_${name}`,
    name,
    repoPath: `/home/you/code/${name}`,
    remoteUrl: `git@github.com:acme/${name}.git`,
    defaultBranch: "main",
    lastActiveAt: null,
    taroProject: null,
    ...overrides,
  };
}

const template: SettingsTemplate = {
  project: "website",
  manager: { model: "claude/claude-sonnet-5-5", thinking: "" },
  owner: { model: "claude/claude-opus-5-5", thinking: "high" },
  subagentModels: ["claude/claude-haiku-5-5"],
  delivery: "local-only",
  acceptAlsoMerges: false,
  trackerSync: "local",
  compactThresholdTokens: 300_000,
  idleCompactThresholdTokens: 150_000,
  maxParallelOwners: 2,
};

describe("suggestProjectName", () => {
  it("lowercases and joins words with dashes", () => {
    expect(suggestProjectName("Billing API")).toBe("billing-api");
    expect(suggestProjectName("my.app")).toBe("my-app");
    expect(suggestProjectName("  --Notes__App--  ")).toBe("notes-app");
  });

  it("cuts to forty characters without a trailing dash", () => {
    const name = suggestProjectName(`${"a".repeat(39)} b`);
    expect(name).toBe("a".repeat(39));
    expect(suggestProjectName("x".repeat(60))).toHaveLength(40);
  });

  it("falls back when nothing usable is left", () => {
    expect(suggestProjectName("")).toBe("project");
    expect(suggestProjectName("日本語")).toBe("project");
  });
});

describe("suggestTicketPrefix", () => {
  it("takes the first letter and the next consonant of one word", () => {
    expect(suggestTicketPrefix("shop", [])).toBe("SH");
    expect(suggestTicketPrefix("taro", [])).toBe("TR");
    expect(suggestTicketPrefix("dotfiles", [])).toBe("DT");
  });

  it("takes the initials of several words, at most eight", () => {
    expect(suggestTicketPrefix("billing-api", [])).toBe("BA");
    expect(suggestTicketPrefix("a-b-c-d-e-f-g-h-i-j", [])).toBe("ABCDEFGH");
  });

  it("avoids prefixes other projects use, in any case", () => {
    expect(suggestTicketPrefix("shop", ["sh"])).toBe("SHP");
    expect(suggestTicketPrefix("taro", ["TR", "TA"])).toBe("TAR");
    expect(suggestTicketPrefix("billing-api", ["BA"])).toBe("BAP");
  });

  it("uses one letter for a one-letter name and a fallback for no letters", () => {
    expect(suggestTicketPrefix("x", [])).toBe("X");
    expect(suggestTicketPrefix("2024", [])).toBe("PR");
    expect(suggestTicketPrefix("2024", ["PR"])).toBe("PRJ");
  });

  it("keeps a taken prefix when every candidate is taken, as the user edits it anyway", () => {
    expect(suggestTicketPrefix("ab", ["AB", "A"])).toBe("AB");
  });

  it("always gives a valid prefix", () => {
    for (const name of ["shop", "a", "billing-api", "x-1", "zzzzzzzzzzzz", ""]) {
      expect(suggestTicketPrefix(name, [])).toMatch(/^[A-Z]{1,8}$/);
    }
  });
});

describe("remoteLabel", () => {
  it("shortens the addresses git takes", () => {
    expect(remoteLabel("git@github.com:acme/shop.git")).toBe("github.com/acme/shop");
    expect(remoteLabel("https://github.com/acme/shop.git")).toBe("github.com/acme/shop");
    expect(remoteLabel("https://token@gitlab.com/you/notes-app/")).toBe("gitlab.com/you/notes-app");
    expect(remoteLabel("ssh://git@example.org:2222/team/repo.git")).toBe("example.org/team/repo");
  });

  it("keeps a local path as it is and gives null without a remote", () => {
    expect(remoteLabel("/srv/git/shop.git")).toBe("/srv/git/shop");
    expect(remoteLabel(null)).toBeNull();
    expect(remoteLabel("  ")).toBeNull();
  });
});

describe("sortCandidates", () => {
  it("puts the most recently used first, never used after, and Taro projects last", () => {
    const sorted = sortCandidates([
      candidate("zeta"),
      candidate("website", { taroProject: "website", lastActiveAt: "2026-10-14T10:00:00Z" }),
      candidate("older", { lastActiveAt: "2026-10-01T10:00:00Z" }),
      candidate("alpha"),
      candidate("newer", { lastActiveAt: "2026-10-13T10:00:00Z" }),
      candidate("blog", { taroProject: "blog" }),
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual(["newer", "older", "alpha", "zeta", "blog", "website"]);
  });

  it("does not change the list it is given", () => {
    const list = [candidate("b"), candidate("a")];
    sortCandidates(list);
    expect(list.map((entry) => entry.name)).toEqual(["b", "a"]);
  });
});

describe("filterCandidates", () => {
  const list = [candidate("shop"), candidate("billing-api", { remoteUrl: null }), candidate("website", { taroProject: "site" })];

  it("matches every word against name, path, remote and Taro name, ignoring case", () => {
    expect(filterCandidates(list, "SHOP").map((entry) => entry.name)).toEqual(["shop"]);
    expect(filterCandidates(list, "code billing").map((entry) => entry.name)).toEqual(["billing-api"]);
    expect(filterCandidates(list, "github acme").map((entry) => entry.name)).toEqual(["shop", "website"]);
    expect(filterCandidates(list, "site").map((entry) => entry.name)).toEqual(["website"]);
    expect(filterCandidates(list, "nothing")).toEqual([]);
  });

  it("keeps everything for an empty search", () => {
    expect(filterCandidates(list, "   ")).toHaveLength(3);
  });
});

describe("candidateDraft", () => {
  it("fills the project fields and copies the last project's settings", () => {
    const draft = candidateDraft(candidate("Billing API", { defaultBranch: "develop" }), template, ["BA"]);
    expect(draft).toMatchObject({
      project: "billing-api",
      repoPath: "/home/you/code/Billing API",
      baseBranch: "develop",
      ticketPrefix: "BAP",
      managerModel: "claude/claude-sonnet-5-5",
      ownerModel: "claude/claude-opus-5-5",
      ownerThinking: "high",
      subagentModels: ["claude/claude-haiku-5-5"],
      delivery: "local-only",
      acceptAlsoMerges: false,
      trackerSync: "remote",
      compactThresholdTokens: "300000",
      idleCompactThresholdTokens: "150000",
      maxParallelOwners: "2",
    });
    expect(setupProblems(draft, true)).toEqual({});
  });

  it("uses the form's defaults before the first project, with pull requests when there is a remote", () => {
    const draft = candidateDraft(candidate("shop"), null, []);
    expect(draft).toMatchObject({ managerModel: "", ownerModel: "", delivery: "pull-request", trackerSync: "remote", acceptAlsoMerges: true, maxParallelOwners: "3" });
  });

  it("keeps tickets and delivery local when the repository has no remote", () => {
    const draft = candidateDraft(candidate("dotfiles", { remoteUrl: null }), { ...template, delivery: "pull-request", trackerSync: "remote" }, []);
    expect(draft).toMatchObject({ delivery: "local-only", trackerSync: "local" });
  });
});

describe("settingsSummary", () => {
  const label = (model: string) => model.replace("claude/claude-", "");

  it("names the models and how work is delivered", () => {
    const draft = candidateDraft(candidate("shop"), template, []);
    expect(settingsSummary(draft, label)).toBe("Manager sonnet-5-5 · Owner opus-5-5 · Local branch, you merge");
    expect(settingsSummary({ ...draft, delivery: "pull-request", acceptAlsoMerges: true }, label)).toBe(
      "Manager sonnet-5-5 · Owner opus-5-5 · Pull request, merged when you accept",
    );
  });

  it("leaves the models out until they are known", () => {
    expect(settingsSummary(candidateDraft(candidate("shop"), null, []), label)).toBe("Pull request, merged when you accept");
  });
});
