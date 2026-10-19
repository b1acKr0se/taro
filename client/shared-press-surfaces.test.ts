/**
 * Accept on the Needs you card left the chat's Accept live (TR-191): each surface had its own guard. So
 * every client file that sends an Accept, a change request or a decision's answer presses through a
 * guard shared per call (`useActions(acceptanceCall(…))` or `useActions(decisionCall(…))`). The scan is
 * textual, and the rule is proven against small bad samples below.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)));
const ANSWERS: Record<string, string> = { acceptTicket: "acceptanceCall", requestChanges: "acceptanceCall", answerDecision: "decisionCall" };

/** What `file` breaks of the rule, one line each; empty when it keeps it. */
function sharedPressProblems(file: string, source: string): string[] {
  return Object.entries(ANSWERS)
    .filter(([rpc]) => new RegExp(`useRpc\\(${rpc}\\)`).test(source))
    .filter(([, call]) => !new RegExp(`useActions\\([^)]*\\b${call}\\(`).test(source))
    .map(([rpc, call]) => `${file} sends ${rpc} without a guard shared per call: press it through useActions(${call}(…))`);
}

describe("sends that answer a call share its guard across surfaces", () => {
  it("holds in every client file", () => {
    const files = readdirSync(CLIENT).filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(20);
    expect(files.flatMap((name) => sharedPressProblems(name, readFileSync(join(CLIENT, name), "utf8")))).toEqual([]);
  });

  it("catches a send through a guard of its own", () => {
    expect(sharedPressProblems("a.tsx", "const accept = useRpc(acceptTicket);\nconst actions = useActions();")).toEqual([
      "a.tsx sends acceptTicket without a guard shared per call: press it through useActions(acceptanceCall(…))",
    ]);
    expect(sharedPressProblems("b.tsx", "const answer = useRpc(answerDecision);\nconst actions = useActions(acceptanceCall(project, ticket));")).toHaveLength(1);
  });

  it("passes a send through the call's shared guard", () => {
    expect(sharedPressProblems("c.tsx", "const answer = useRpc(answerDecision);\nconst presses = useActions(approving === null ? undefined : decisionCall(key));")).toEqual([]);
    expect(sharedPressProblems("d.tsx", "const load = useRpc(loadTicket);")).toEqual([]);
  });
});
