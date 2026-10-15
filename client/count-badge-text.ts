/** Past this a count badge reads "99+", so the pill stays the width of two digits and a sign. */
export const COUNT_BADGE_MAX = 99;

/** The text of a count badge (TR-123), or null where there is none to draw: nothing waits. */
export function countBadgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > COUNT_BADGE_MAX ? `${COUNT_BADGE_MAX}+` : String(Math.floor(count));
}

/** What waits on the user across projects, as the sidebar, the Inbox and notifications count it (TR-064). */
export function needsYouTotal(projects: ReadonlyArray<{ needsYou: number }>): number {
  return projects.reduce((total, project) => total + project.needsYou, 0);
}
