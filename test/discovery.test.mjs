import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverGlobalEngineerRuntimes,
  discoverGlobalKitInstalls,
  discoverProjectCandidates,
  parseProjectRegistry,
  parseRemoteProbeOutput,
  scanForOwnedProjects,
} from "../lib/discovery.mjs";

async function makeOwnedProject(path, runtime = "codex") {
  await mkdir(join(path, ".agentkit"), { recursive: true });
  await writeFile(join(path, ".agentkit", "ownership.json"), JSON.stringify({
    version: 1, project_id: "fixture",
  }));
  const manifest = join(
    path, ".agentkit", "adapters", runtime, "engineer", ".agentkit", "install-manifest.json",
  );
  await mkdir(join(manifest, ".."), { recursive: true });
  await writeFile(manifest, '{"version":1,"kit":"engineer"}\n');
}

test("parses the official project registry JSON contract", () => {
  assert.deepEqual(parseProjectRegistry(JSON.stringify({
    schema_version: 1,
    data: { projects: [{ name: "demo", dir: "/tmp/demo" }], total: 1 },
  })), [{ name: "demo", path: "/tmp/demo" }]);
  assert.throws(() => parseProjectRegistry("{}"), /unsupported/);
});

test("global discovery requires an Engineer install manifest for a supported runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-global-"));
  const akHome = join(directory, ".agentkit");
  const supported = join(
    akHome, "adapters", "codex", "engineer", ".agentkit", "install-manifest.json",
  );
  const unsupported = join(
    akHome, "adapters", "omp", "engineer", ".agentkit", "install-manifest.json",
  );
  await mkdir(join(supported, ".."), { recursive: true });
  await mkdir(join(unsupported, ".."), { recursive: true });
  await writeFile(supported, '{"version":1,"kit":"engineer"}\n');
  await writeFile(unsupported, '{"version":1,"kit":"engineer"}\n');
  try {
    assert.deepEqual(await discoverGlobalEngineerRuntimes({
      akHome,
      supportedRuntimes: new Set(["codex", "cursor"]),
    }), ["codex"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("global discovery reports Engineer and Marketing installs separately", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-global-kits-"));
  const akHome = join(directory, ".agentkit");
  for (const [kit, runtime] of [["engineer", "codex"], ["marketing", "cursor"]]) {
    const manifest = join(
      akHome, "adapters", runtime, kit, ".agentkit", "install-manifest.json",
    );
    await mkdir(join(manifest, ".."), { recursive: true });
    await writeFile(manifest, JSON.stringify({ version: 1, kit }));
  }
  try {
    assert.deepEqual(await discoverGlobalKitInstalls({
      akHome,
      supportedRuntimes: new Set(["codex", "cursor"]),
    }), [
      { kit: "engineer", runtimes: ["codex"] },
      { kit: "marketing", runtimes: ["cursor"] },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deep scan finds valid ownership markers and skips excluded and linked trees", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-scan-"));
  const root = join(directory, "projects");
  const owned = join(root, "owned");
  const excluded = join(root, "node_modules", "hidden-project");
  const external = join(directory, "external");
  await makeOwnedProject(owned);
  await makeOwnedProject(excluded);
  await makeOwnedProject(external);
  await symlink(external, join(root, "linked-project"));
  try {
    const result = await scanForOwnedProjects(root, { home: directory, maxDepth: 4 });
    assert.deepEqual(result.projects, [await realpath(owned)]);
    assert.deepEqual(result.warnings, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deep scan rejects filesystem root and the whole home directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-home-"));
  try {
    await assert.rejects(() => scanForOwnedProjects(directory, { home: directory }), /too broad/);
    await assert.rejects(() => scanForOwnedProjects(process.platform === "win32" ? "C:\\" : "/"), /too broad/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("discovery deduplicates current, registry, and deep-scan projects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-discover-"));
  const home = join(directory, "home");
  const root = join(directory, "projects");
  const project = join(root, "demo");
  await mkdir(home);
  await makeOwnedProject(project);
  try {
    const registryOutput = JSON.stringify({
      schema_version: 1,
      data: { projects: [{ name: "demo", dir: project }], total: 1 },
    });
    const result = await discoverProjectCandidates({
      cwd: project,
      registryOutput,
      deepScanRoots: [root],
      home,
      supportedRuntimes: new Set(["codex"]),
    });
    assert.equal(result.projects.length, 1);
    assert.deepEqual(result.projects[0].sources, ["current", "deep-scan", "registry"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("parseRemoteProbeOutput ignores MOTD and parses binary info and installed manifests", () => {
  const rawOutput = `
Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-40-generic x86_64)
 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/pro

Last login: Wed Sep  2 20:00:00 2026 from 1.2.3.4
===AK_PROBE===
AK_PATH:/home/ubuntu/.local/bin/ak
AK_VERSION:ak 2.15.0-beta.3
INSTALLED:engineer:codex
INSTALLED:engineer:omp
INSTALLED:marketing:codex
`;
  const parsed = parseRemoteProbeOutput(rawOutput);
  assert.equal(parsed.reachable, true);
  assert.equal(parsed.akInstalled, true);
  assert.equal(parsed.akPath, "/home/ubuntu/.local/bin/ak");
  assert.equal(parsed.akVersion, "2.15.0-beta.3");
  assert.equal(parsed.channel, "beta");
  assert.deepEqual(parsed.installs, [
    { kit: "engineer", runtimes: ["codex", "omp"] },
    { kit: "marketing", runtimes: ["codex"] },
  ]);
});

test("parseRemoteProbeOutput handles missing remote ak binary", () => {
  const rawOutput = `
===AK_PROBE===
AK_PATH:
AK_VERSION:
`;
  const parsed = parseRemoteProbeOutput(rawOutput);
  assert.equal(parsed.reachable, true);
  assert.equal(parsed.akInstalled, false);
  assert.equal(parsed.akPath, null);
  assert.equal(parsed.akVersion, null);
  assert.equal(parsed.channel, "stable");
  assert.deepEqual(parsed.installs, []);
});

test("parseRemoteProbeOutput throws on missing probe marker", () => {
  assert.throws(
    () => parseRemoteProbeOutput("Permission denied (publickey).\n"),
    /missing probe marker/,
  );
});
