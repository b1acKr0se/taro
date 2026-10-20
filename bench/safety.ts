/**
 * What the benchmark refuses to touch: the user's real Paseo daemon (port 6767, `~/.paseo`) and any
 * path that is not a fresh absolute `mktemp -d` directory under the temporary folder. Runs under Node
 * type stripping: erasable syntax, `.ts` import extensions, no packages.
 */
import { homedir, tmpdir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";

export const REAL_DAEMON_PORT = 6767;
export const PORT_RANGE = { first: 6810, last: 6899 };
/** Every directory the benchmark makes starts with this, so a removal can prove it is removing its own. */
export const SCRATCH_PREFIX = "taro-bench-";

function inside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
}

/** Throws unless the port is one the benchmark may start a daemon on. */
export function assertSafePort(port: number): void {
  if (port === REAL_DAEMON_PORT) throw new Error(`refusing port ${REAL_DAEMON_PORT}: it is the real Paseo daemon`);
  if (!Number.isInteger(port) || port < PORT_RANGE.first || port > PORT_RANGE.last) {
    throw new Error(`refusing port ${port}: a throwaway daemon uses ${PORT_RANGE.first}-${PORT_RANGE.last}`);
  }
}

/** Throws unless the path is an absolute folder of this benchmark's under the temporary folder and not under `~/.paseo`. */
export function assertSafeHome(path: string, home = homedir(), temporary = tmpdir()): void {
  if (path === "" || path.trim() === "") throw new Error("refusing an empty path");
  if (!isAbsolute(path)) throw new Error(`refusing the relative path ${path}`);
  const resolved = resolve(path);
  if (inside(resolved, resolve(home, ".paseo")) || inside(resolved, "/root/.paseo")) throw new Error(`refusing ${resolved}: it is under ~/.paseo, the real daemon's home`);
  if (resolved === resolve(home) || resolved === "/" || resolved === resolve(temporary)) throw new Error(`refusing ${resolved}: not a folder of its own`);
  const name = resolved.slice(resolve(temporary).length + 1);
  if (!inside(resolved, resolve(temporary)) || !name.startsWith(SCRATCH_PREFIX) || name.includes(sep)) {
    throw new Error(`refusing ${resolved}: only ${resolve(temporary)}/${SCRATCH_PREFIX}* folders are made or removed`);
  }
}
