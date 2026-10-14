/**
 * View plan (TR-061): the Taro screen opens a ticket's Ticket tab, its Plan at the top, and Back
 * returns to where the user pressed it. Cards deep in the Inbox, a chat or the board reach the
 * screen through this context; outside the screen (Paseo's own agent tab) there is none, and the
 * card unfolds the plan in place instead.
 */
import { createContext, useContext } from "react";

export type ViewPlan = (project: string, ticket: string) => void;

export const PlanNavigation = createContext<ViewPlan | null>(null);

export function useViewPlan(): ViewPlan | null {
  return useContext(PlanNavigation);
}
