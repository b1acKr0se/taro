/**
 * The default pull-request body (`skill/templates/pull-request.md`, TR-250): its section headings in
 * one place, and the check that warns on the Accept card when a body lacks them. A warning only: it
 * never blocks Awaiting acceptance or Accept.
 */

/** The template's `##` headings, in order; a test reads the template file and fails when they drift. */
export const PULL_REQUEST_TEMPLATE_HEADINGS = ["What changed", "Ticket", "Checks", "Evidence"] as const;

/** Where a repository keeps its own PR template, relative to its root; any of them replaces the default. */
export const REPOSITORY_TEMPLATE_PATHS = [
  "pull_request_template.md",
  ".github/pull_request_template.md",
  "docs/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE",
  "docs/PULL_REQUEST_TEMPLATE",
  "PULL_REQUEST_TEMPLATE",
] as const;

/** What `gh pr view` says of a pull request's text. */
export interface PullRequestDescription {
  body: string;
  /** Each commit's whole message (headline, blank line, body). */
  commitMessages: readonly string[];
}

function normalised(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function headingsOf(body: string): Set<string> {
  const found = new Set<string>();
  for (const match of body.matchAll(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/gm)) found.add(normalised(match[1] ?? ""));
  return found;
}

/**
 * What is wrong with a body against the default template, as a phrase after "The pull request
 * description": null when it passes. A body equal to a commit's message, its headline or its body (what `--fill` copies) is a copy, however many headings it happens to carry.
 */
export function pullRequestBodyProblem(description: PullRequestDescription): string | null {
  const body = normalised(description.body);
  if (body === "") return "is empty";
  const copies = description.commitMessages.flatMap((message) => {
    const [headline = "", ...rest] = message.split("\n");
    return [message, headline, rest.join("\n")];
  });
  if (copies.some((copy) => normalised(copy) === body)) return "repeats the commit message";
  const present = headingsOf(description.body);
  const missing = PULL_REQUEST_TEMPLATE_HEADINGS.filter((heading) => !present.has(normalised(heading)));
  return missing.length === 0 ? null : `has no ${missing.join(", ")} section${missing.length === 1 ? "" : "s"}`;
}

/** The owner's record that the default template does not fit this pull request: `PR-TEMPLATE <time> — <why>`. */
export function pullRequestTemplateWaived(notes: string | null): boolean {
  return /^[ \t>*-]*\**PR-TEMPLATE\b/m.test(notes ?? "");
}

/** The warning line for the card; says how to clear it. */
export function pullRequestBodyWarning(problem: string): string {
  return `The pull request description ${problem}, but the default template applies. Fix the description, or record why the template does not fit.`;
}
