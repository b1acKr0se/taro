/** The order of the project tabs: newest on the left until the user drags, then the order they left. */

export interface OrderedProject {
  name: string;
  /** When the project's folder was made, in ms; 0 when unknown. */
  createdMs: number;
}

/**
 * The saved order first, but a project it does not name (made since the user last dragged) goes to the
 * left, newest first, so a new project is where the user looks. A saved name with no project is dropped.
 */
export function orderProjects<Project extends OrderedProject>(projects: readonly Project[], saved: readonly string[]): Project[] {
  const rank = new Map<string, number>();
  saved.forEach((name, index) => {
    if (!rank.has(name)) rank.set(name, index);
  });
  const unsaved = projects
    .filter((project) => !rank.has(project.name))
    .sort((left, right) => right.createdMs - left.createdMs || left.name.localeCompare(right.name));
  const kept = projects.filter((project) => rank.has(project.name)).sort((left, right) => (rank.get(left.name) ?? 0) - (rank.get(right.name) ?? 0));
  return [...unsaved, ...kept];
}

/** Moves `name` to `index` among `names`; an unknown name or a no-op returns the list unchanged. */
export function moveProject(names: readonly string[], name: string, index: number): string[] {
  const from = names.indexOf(name);
  if (from === -1) return [...names];
  const without = names.filter((_, position) => position !== from);
  const target = Math.max(0, Math.min(without.length, index));
  return [...without.slice(0, target), name, ...without.slice(target)];
}
