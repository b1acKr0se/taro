import { describe, expect, it } from "vitest";

import { paneVisibility } from "./pane-visibility";

describe("paneVisibility", () => {
  it("tells its listeners when the pane hides and shows again, once per change", () => {
    const pane = paneVisibility(null, true);
    const heard: boolean[] = [];
    pane.listen(() => heard.push(pane.shown()));
    pane.set(false);
    pane.set(false);
    pane.set(true);
    expect(heard).toEqual([false, true]);
  });

  it("is hidden while the pane around it is, though shown itself", () => {
    const project = paneVisibility(null, true);
    const managerTab = paneVisibility(project, true);
    const heard: boolean[] = [];
    managerTab.listen(() => heard.push(managerTab.shown()));
    project.set(false);
    expect(managerTab.shown()).toBe(false);
    project.set(true);
    expect(heard).toEqual([false, true]);
  });

  it("says nothing when the pane around it hides while it is hidden already", () => {
    const project = paneVisibility(null, true);
    const statsTab = paneVisibility(project, false);
    const heard: boolean[] = [];
    statsTab.listen(() => heard.push(statsTab.shown()));
    project.set(false);
    project.set(true);
    expect(heard).toEqual([]);
  });

  it("stops hearing the pane around it once disposed", () => {
    const project = paneVisibility(null, true);
    const managerTab = paneVisibility(project, true);
    const heard: boolean[] = [];
    managerTab.listen(() => heard.push(managerTab.shown()));
    managerTab.dispose();
    project.set(false);
    expect(heard).toEqual([]);
  });

  it("starts hidden for a pane built ahead of use", () => {
    expect(paneVisibility(null, false).shown()).toBe(false);
  });
});
