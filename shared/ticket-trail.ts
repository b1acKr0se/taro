/**
 * The children a ticket's detail has opened in place (TR-187): a child row opens that child over its
 * parent, its back row returns one step. The trail belongs to the ticket it started from, so another
 * ticket shown in the same place starts from itself.
 */
export interface TicketTrail {
  root: string;
  /** The opened children, the one shown last. */
  opened: readonly string[];
}

export function startTrail(root: string): TicketTrail {
  return { root, opened: [] };
}

/** The trail as it stands for `root`: one kept for another ticket is dropped. */
export function trailFor(trail: TicketTrail, root: string): TicketTrail {
  return trail.root === root ? trail : startTrail(root);
}

/** What is shown, and the ticket its back row returns to (null at the root: no back row). */
export function trailView(trail: TicketTrail): { shown: string; back: string | null } {
  const { opened, root } = trail;
  if (opened.length === 0) return { shown: root, back: null };
  return { shown: opened[opened.length - 1] ?? root, back: opened.length === 1 ? root : (opened[opened.length - 2] ?? root) };
}

export function openChild(trail: TicketTrail, child: string): TicketTrail {
  return { root: trail.root, opened: [...trail.opened, child] };
}

export function goBack(trail: TicketTrail): TicketTrail {
  return { root: trail.root, opened: trail.opened.slice(0, -1) };
}
