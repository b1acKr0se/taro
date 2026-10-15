import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (name: string): { description: string } => JSON.parse(readFileSync(join(root, name), "utf8"));

describe("the plugin's one-line description (TR-104)", () => {
  it("is the user's text in Paseo's manifest, and package.json mirrors it", () => {
    expect(read("paseo-plugin.json").description).toBe(
      "Agents work through your whole ticket board on their own: a manager files your requests as tickets, and owner agents take every one to completion, spawning subagents to build, test and review.",
    );
    expect(read("package.json").description).toBe(read("paseo-plugin.json").description);
  });
});
