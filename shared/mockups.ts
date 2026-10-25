/**
 * The mockups of a plan (TR-235): a plan that adds or changes UI shows the user what would change
 * before they approve it. The plan's "Mockups" section holds one `file — what changes` line per
 * screenshot, or `none — <why there is no UI change>`. The files sit in the ticket's evidence
 * folder; whether they exist is told by the caller. Pure.
 */
import { isBareFileName, splitAtSeparator } from "./evidence";
import type { ParsedPlan } from "./plan";

export interface PlanMockup {
  file: string;
  /** What changes on the screen the image shows; "" when the line has none. */
  description: string;
}

export interface ParsedMockups {
  /** Null when the plan has no Mockups section. */
  section: { images: PlanMockup[]; none: string | null } | null;
}

export interface JudgedMockups {
  images: (PlanMockup & { present: boolean; path: string })[];
  /** The reason after `none —`; null when the plan names images or has no section. */
  none: string | null;
  /** What the plan still lacks, in the owner's terms; empty when it may be asked. */
  missing: string[];
}

/** The plan's Mockups section, its bullets read as lines (backticks around a file name allowed). */
export function parseMockups(plan: ParsedPlan | null): ParsedMockups {
  const section = plan?.sections.find((each) => each.key === "mockups");
  if (section === undefined) return { section: null };
  const lines = [...section.items, ...section.prose.split("\n")].map((line) => line.trim()).filter((line) => line !== "");
  const images: PlanMockup[] = [];
  let none: string | null = null;
  lines.forEach((line) => {
    const [first, rest] = splitAtSeparator(line);
    const file = first.replace(/^`+|`+$/g, "");
    if (file.toLowerCase() === "none") none = rest;
    else if (file !== "") images.push({ file, description: rest });
  });
  return { section: { images, none } };
}

/** The plan's mockups against the files in the ticket's evidence folder (`folder` joins a file name to its path). */
export function judgeMockups(plan: ParsedPlan | null, existingFiles: ReadonlySet<string>, folder: string): JudgedMockups {
  const { section } = parseMockups(plan);
  const images = (section?.images ?? []).map((image) => {
    const usable = isBareFileName(image.file);
    return { ...image, present: usable && existingFiles.has(image.file), path: usable ? `${folder}/${image.file}` : "" };
  });
  const missing: string[] = [];
  if (section === null) missing.push("a Mockups section (the screenshots of what changes, or `none — <why there is no UI change>`)");
  else if (images.length === 0 && section.none === null) missing.push("a mockup line (`file — what changes`) or `none — <why>` under Mockups");
  else if (images.length === 0 && section.none === "") missing.push("a reason after `none —` under Mockups");
  images.forEach((image) => {
    if (!isBareFileName(image.file)) missing.push(`a plain file name for mockup ${image.file} (no folders)`);
    else if (!image.present) missing.push(`mockup file ${image.file} in the evidence folder`);
    if (image.description === "") missing.push(`a description for mockup ${image.file}`);
  });
  return { images, none: images.length === 0 ? section?.none ?? null : null, missing };
}
