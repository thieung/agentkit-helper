import { stat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, parse, resolve } from "node:path";
import { findKitRuntimes, isOwnedProject } from "./discovery.mjs";
import { releaseChannelForVersion } from "./self-update.mjs";

export function syncChannelFromBinary(version) {
  return releaseChannelForVersion(version) || "stable";
}

export function resolveHelperHome(home = process.env.AK_HELPER_HOME || homedir()) {
  return home;
}

export async function resolveCanonicalHome(home = resolveHelperHome()) {
  try {
    return await realpath(home);
  } catch {
    return resolve(home);
  }
}

function normalizePath(path) {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export function isHomeOrRootSyncCwd(cwd, home = resolveHelperHome()) {
  const absolute = normalizePath(cwd);
  return absolute === normalizePath(parse(resolve(cwd)).root) ||
    absolute === normalizePath(home);
}

export async function discoverSyncProject({
  cwd = process.cwd(),
  home = resolveHelperHome(),
  supportedRuntimes = [],
  kits = ["engineer", "marketing"],
} = {}) {
  const canonicalHome = await resolveCanonicalHome(home);
  if (isHomeOrRootSyncCwd(cwd, canonicalHome)) return null;
  let canonical;
  try {
    const absolute = resolve(cwd);
    const metadata = await stat(absolute);
    if (!metadata.isDirectory()) return null;
    canonical = await realpath(absolute);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EACCES" || error.code === "EPERM") return null;
    throw error;
  }
  if (isHomeOrRootSyncCwd(canonical, canonicalHome)) return null;
  if (!(await isOwnedProject(canonical))) return null;
  const installs = [];
  for (const kit of kits) {
    const runtimes = await findKitRuntimes(canonical, supportedRuntimes, kit);
    installs.push(...runtimes.map((runtime) => ({ kit, runtime })));
  }
  if (installs.length === 0) return null;
  return {
    id: `project:${canonical}`,
    kind: "project",
    name: basename(canonical),
    path: canonical,
    installs,
    runtimes: [...new Set(installs.map((install) => install.runtime))],
    sources: ["current"],
  };
}
