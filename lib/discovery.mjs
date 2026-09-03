import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, parse, resolve } from "node:path";
import { remoteProbeSnippet } from "./commands.mjs";
import { runSshCapture } from "./runner.mjs";
import { releaseChannelForVersion } from "./self-update.mjs";

export const DEFAULT_SCAN_EXCLUDES = new Set([
  ".git", "node_modules", "dist", "build", "out", ".next", ".cache", "Library", ".Trash",
]);

function expandHome(input, home) {
  if (input === "~") return home;
  if (input.startsWith("~/")) return resolve(home, input.slice(2));
  return input;
}

async function canonicalDirectory(input, { home = homedir(), rejectBroad = false } = {}) {
  const absolute = resolve(expandHome(input, home));
  const metadata = await lstat(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`not a real directory: ${input}`);
  }
  const canonical = await realpath(absolute);
  if (rejectBroad) {
    const canonicalHome = await realpath(home);
    if (canonical === parse(canonical).root || canonical === canonicalHome) {
      throw new Error(`deep scan root is too broad: ${canonical}`);
    }
  }
  return canonical;
}

export async function isOwnedProject(project) {
  try {
    const marker = resolve(project, ".agentkit", "ownership.json");
    const metadata = await lstat(marker);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
    const value = JSON.parse(await readFile(marker, "utf8"));
    return Boolean(
      value && typeof value === "object" && !Array.isArray(value) &&
      value.version === 1 && typeof value.project_id === "string" && value.project_id.trim(),
    );
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

async function hasManifest(path, kit) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
    const value = JSON.parse(await readFile(path, "utf8"));
    return Boolean(
      value && typeof value === "object" && !Array.isArray(value) &&
      value.version === 1 && value.kit === kit,
    );
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function findKitRuntimes(root, supportedRuntimes, kit) {
  const runtimes = [];
  for (const runtime of supportedRuntimes) {
    const manifest = resolve(
      root, ".agentkit", "adapters", runtime, kit, ".agentkit", "install-manifest.json",
    );
    if (await hasManifest(manifest, kit)) runtimes.push(runtime);
  }
  return runtimes;
}

export function findEngineerRuntimes(root, supportedRuntimes) {
  return findKitRuntimes(root, supportedRuntimes, "engineer");
}

export async function discoverGlobalKitInstalls({
  akHome = resolve(homedir(), ".agentkit"),
  supportedRuntimes = [],
  kits = ["engineer", "marketing"],
} = {}) {
  const root = resolve(akHome, "..");
  const installs = [];
  for (const kit of kits) {
    const runtimes = await findKitRuntimes(root, supportedRuntimes, kit);
    if (runtimes.length > 0) installs.push({ kit, runtimes });
  }
  return installs;
}

export async function discoverGlobalEngineerRuntimes({
  akHome = resolve(homedir(), ".agentkit"),
  supportedRuntimes = [],
} = {}) {
  return findKitRuntimes(resolve(akHome, ".."), supportedRuntimes, "engineer");
}

export function parseProjectRegistry(output) {
  const value = JSON.parse(output);
  const projects = value?.data?.projects;
  if (value?.schema_version !== 1 || !Array.isArray(projects)) {
    throw new Error("unsupported ak projects list JSON contract");
  }
  return projects
    .filter((project) => typeof project?.dir === "string" && project.dir.trim())
    .map((project) => ({ name: project.name || basename(project.dir), path: project.dir }));
}

export async function scanForOwnedProjects(
  inputRoot,
  { maxDepth = 5, excludes = [], home = homedir() } = {},
) {
  const root = await canonicalDirectory(inputRoot, { home, rejectBroad: true });
  const excluded = new Set([...DEFAULT_SCAN_EXCLUDES, ...excludes]);
  const projects = [];
  const warnings = [];
  const pending = [{ path: root, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop();
    try {
      if (await isOwnedProject(current.path)) projects.push(current.path);
      if (current.depth >= maxDepth) continue;
      const entries = await readdir(current.path, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (entry.name === ".agentkit" || excluded.has(entry.name)) continue;
        pending.push({ path: resolve(current.path, entry.name), depth: current.depth + 1 });
      }
    } catch (error) {
      if (error.code === "EACCES" || error.code === "EPERM" || error.code === "ENOENT") {
        warnings.push(`${current.path}: ${error.code}`);
        continue;
      }
      throw error;
    }
  }

  projects.sort();
  return { root, projects, warnings };
}

export async function discoverProjectCandidates({
  cwd = process.cwd(),
  registryOutput,
  deepScanRoots = [],
  maxDepth = 5,
  excludes = [],
  home = homedir(),
  supportedRuntimes = [],
  kits = ["engineer", "marketing"],
}) {
  const candidates = new Map();
  const warnings = [];

  async function add(path, source, name) {
    try {
      const canonical = await canonicalDirectory(path, { home });
      if (!(await isOwnedProject(canonical))) return;
      const installs = [];
      for (const kit of kits) {
        const runtimes = await findKitRuntimes(canonical, supportedRuntimes, kit);
        installs.push(...runtimes.map((runtime) => ({ kit, runtime })));
      }
      if (installs.length === 0) return;
      const existing = candidates.get(canonical);
      if (existing) {
        existing.sources.add(source);
        return;
      }
      candidates.set(canonical, {
        id: `project:${canonical}`,
        kind: "project",
        name: name || basename(canonical),
        path: canonical,
        installs,
        runtimes: [...new Set(installs.map((install) => install.runtime))],
        sources: new Set([source]),
      });
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EACCES" || error.code === "EPERM") {
        warnings.push(`${path}: ${error.code}`);
        return;
      }
      throw error;
    }
  }

  await add(cwd, "current");
  for (const project of parseProjectRegistry(registryOutput)) {
    await add(project.path, "registry", project.name);
  }
  for (const root of deepScanRoots) {
    const result = await scanForOwnedProjects(root, { maxDepth, excludes, home });
    warnings.push(...result.warnings);
    for (const project of result.projects) await add(project, "deep-scan");
  }

  return {
    projects: [...candidates.values()].map((candidate) => ({
      ...candidate,
      sources: [...candidate.sources].sort(),
    })).sort((left, right) => left.path.localeCompare(right.path)),
    warnings,
  };
}

export function parseRemoteProbeOutput(rawOutput) {
  const text = String(rawOutput || "");
  const marker = "===AK_PROBE===";
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error("missing probe marker in remote output");
  }

  const lines = text.slice(markerIndex + marker.length)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let akPath = null;
  let akVersion = null;
  const kitRuntimes = new Map();

  for (const line of lines) {
    if (line.startsWith("AK_PATH:")) {
      const value = line.slice("AK_PATH:".length).trim();
      akPath = value || null;
    } else if (line.startsWith("AK_VERSION:")) {
      const rawVersion = line.slice("AK_VERSION:".length).trim();
      const cleaned = rawVersion.replace(/^ak\s+/i, "").trim();
      akVersion = cleaned || null;
    } else if (line.startsWith("INSTALLED:")) {
      const parts = line.slice("INSTALLED:".length).split(":");
      if (parts.length === 2) {
        const [kit, runtime] = parts;
        if (!kitRuntimes.has(kit)) kitRuntimes.set(kit, new Set());
        kitRuntimes.get(kit).add(runtime);
      }
    }
  }

  const akInstalled = Boolean(akPath);
  const channel = akVersion ? (releaseChannelForVersion(akVersion) || "stable") : "stable";
  const installs = [];
  for (const [kit, runtimes] of kitRuntimes.entries()) {
    installs.push({ kit, runtimes: [...runtimes] });
  }

  return {
    reachable: true,
    akInstalled,
    akPath,
    akVersion,
    channel,
    installs,
  };
}

export async function probeRemoteVps(host, { runner, batchMode = false } = {}) {
  const runCaptureFn = runner?.runSshCapture || runSshCapture;
  const { stdout } = await runCaptureFn(host, remoteProbeSnippet(), { batchMode });
  return parseRemoteProbeOutput(stdout);
}
