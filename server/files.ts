/** Small file utilities: atomic JSON/text writes and tolerant reads. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeTextAtomically(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, path);
}

export async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await writeTextAtomically(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The file's text, or null when it does not exist. */
export async function readTextIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readJsonIfPresent(path: string): Promise<unknown> {
  const text = await readTextIfPresent(path);
  return text === null ? null : (JSON.parse(text) as unknown);
}

/** Writes the file only when it does not exist yet; returns whether it wrote. */
export async function writeTextIfMissing(path: string, text: string): Promise<boolean> {
  if ((await readTextIfPresent(path)) !== null) return false;
  await writeTextAtomically(path, text);
  return true;
}
