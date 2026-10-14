import { describe, expect, it } from "vitest";

import { gainedGuidelines, identityChanges, mergeProtection, PROTECTION_ALERT_MS, protectionAlert, withCommittedIdentity } from "./tracker-guard";

const CONFIG = 'project_name: "taro"\ndefault_status: "Backlog"\nzero_padded_ids: 3\ntask_prefix: "TR"\n';

describe("identityChanges", () => {
  it("finds nothing when only other keys or formatting changed", () => {
    const reformatted = CONFIG.replace('default_status: "Backlog"', 'default_status: "To Do"').replace('"taro"', "'taro'");
    expect(identityChanges(CONFIG, reformatted)).toEqual([]);
    expect(identityChanges(CONFIG, CONFIG)).toEqual([]);
  });

  it("names a renamed project, as backlog init leaves it", () => {
    expect(identityChanges(CONFIG, CONFIG.replace('"taro"', '"scratch"'))).toEqual(['project_name "taro" → "scratch"']);
  });

  it("names every identity key that changed, a removed one included", () => {
    const changed = 'project_name: "taro"\ntask_prefix: "task"\n';
    expect(identityChanges(CONFIG, changed)).toEqual(['task_prefix "TR" → "task"', 'zero_padded_ids "3" → (none)']);
  });

  it("treats an emptied config as every key changed", () => {
    expect(identityChanges(CONFIG, "")).toHaveLength(3);
  });

  it("does not flag a key the committed config lacks, as Backlog adds task_prefix itself", () => {
    const withoutPrefix = CONFIG.replace('task_prefix: "TR"\n', "");
    expect(identityChanges(withoutPrefix, `${withoutPrefix}task_prefix: "task"\n`)).toEqual([]);
  });

  it("does not take a key that only starts like an identity key", () => {
    expect(identityChanges(CONFIG, `${CONFIG}project_name_old: "x"\n`)).toEqual([]);
  });
});

describe("withCommittedIdentity", () => {
  it("puts back only the changed identity lines and keeps other edits", () => {
    const working = CONFIG.replace('"taro"', '"scratch"').replace('default_status: "Backlog"', 'default_status: "Planning"');
    expect(withCommittedIdentity(CONFIG, working)).toBe(CONFIG.replace('default_status: "Backlog"', 'default_status: "Planning"'));
  });

  it("adds back a removed identity line, after a missing final newline too", () => {
    const working = 'project_name: "taro"\ndefault_status: "Backlog"\ntask_prefix: "TR"';
    expect(withCommittedIdentity(CONFIG, working)).toBe(`${working}\nzero_padded_ids: 3\n`);
  });

  it("returns the working text untouched when nothing changed", () => {
    const working = `${CONFIG}labels: []\n`;
    expect(withCommittedIdentity(CONFIG, working)).toBe(working);
  });
});

describe("gainedGuidelines", () => {
  const block = "<!-- BACKLOG.MD GUIDELINES START -->\n<!-- backlog.md-instructions-version: 1.53.0 -->\nUse the CLI.\n<!-- BACKLOG.MD GUIDELINES END -->\n";

  it("flags Backlog's block added to a committed file", () => {
    expect(gainedGuidelines("# Rules\n", `# Rules\n\n${block}`)).toBe(true);
  });

  it("flags a new, uncommitted file holding the block", () => {
    expect(gainedGuidelines(null, block)).toBe(true);
  });

  it("flags a block rewritten in place, the MCP variant too", () => {
    const mcp = block.replace(/GUIDELINES/g, "MCP GUIDELINES");
    expect(gainedGuidelines(`# Rules\n${block}`, `# Rules\n${block.replace("1.53.0", "1.60.0")}`)).toBe(true);
    expect(gainedGuidelines("# Rules\n", `# Rules\n${mcp}`)).toBe(true);
  });

  it("leaves a file whose block is unchanged, or that has none", () => {
    expect(gainedGuidelines(`# Rules\n${block}`, `# Rules, edited\n${block}`)).toBe(false);
    expect(gainedGuidelines("# Rules\n", "# Rules, edited\n")).toBe(false);
    expect(gainedGuidelines(null, "# Mine\n")).toBe(false);
  });
});

describe("protection alerts", () => {
  const at = "2026-10-14T08:00:00.000Z";
  const now = Date.parse(at);

  it("merges refusals: the latest time, each description once", () => {
    const first = mergeProtection(null, ["AGENTS.md (x)"], "2026-10-14T07:00:00.000Z");
    expect(mergeProtection(first, ["backlog/config.yml (y)", "AGENTS.md (x)"], at)).toEqual({ at, restored: ["AGENTS.md (x)", "backlog/config.yml (y)"] });
  });

  it("shows for a day after the last refusal, then not", () => {
    const protection = { at, restored: ['backlog/config.yml (project_name "taro" → "scratch")'] };
    expect(protectionAlert(protection, now)?.text).toContain('project_name "taro" → "scratch"');
    expect(protectionAlert(protection, now + PROTECTION_ALERT_MS - 1)?.id).toBe("tracker-protected");
    expect(protectionAlert(protection, now + PROTECTION_ALERT_MS)).toBeNull();
  });

  it("shows nothing without a refusal or with an unreadable time", () => {
    expect(protectionAlert(null, now)).toBeNull();
    expect(protectionAlert({ at, restored: [] }, now)).toBeNull();
    expect(protectionAlert({ at: "garbage", restored: ["x"] }, now)).toBeNull();
  });
});
