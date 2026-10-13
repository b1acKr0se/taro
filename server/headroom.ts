/**
 * The host's thread headroom (TR-012), from the cgroup's pids files. Every agent,
 * helper, reviewer and test daemon costs threads, so the owner cap alone does not
 * keep the host under its limit.
 */
import { join } from "node:path";

import { isHigh, parsePids, type Headroom } from "../shared/recovery";
import { readTextIfPresent } from "./files";

/** `TARO_CGROUP_DIR` points elsewhere for tests (a directory holding fake pids files). */
function cgroupDirectory(): string {
  const override = process.env.TARO_CGROUP_DIR?.trim();
  return override === undefined || override === "" ? "/sys/fs/cgroup" : override;
}

let highSince: string | null = null;

/** The current usage, or null where the host publishes no limit. Remembers when usage went high. */
export async function readHeadroom(): Promise<Headroom | null> {
  const directory = cgroupDirectory();
  const [current, max] = await Promise.all([
    readTextIfPresent(join(directory, "pids.current")).catch(() => null),
    readTextIfPresent(join(directory, "pids.max")).catch(() => null),
  ]);
  const pids = parsePids(current, max);
  if (pids === null) {
    highSince = null;
    return null;
  }
  const high = isHigh(pids);
  if (!high) highSince = null;
  else highSince ??= new Date().toISOString();
  return { ...pids, high, highSince };
}
