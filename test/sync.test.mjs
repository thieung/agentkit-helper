import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import {
  discoverSyncProject,
  isHomeOrRootSyncCwd,
  resolveHelperHome,
  syncChannelFromBinary,
} from "../lib/sync.mjs";

test("infers sync channel from the installed ak version", () => {
  assert.equal(syncChannelFromBinary("ak 2.14.0"), "stable");
  assert.equal(syncChannelFromBinary("2.15.0-beta.5"), "beta");
  assert.equal(syncChannelFromBinary("not-a-version"), "stable");
});

test("home and filesystem root stay global-only for sync", () => {
  const home = "/tmp/example-home";
  assert.equal(isHomeOrRootSyncCwd(home, home), true);
  assert.equal(isHomeOrRootSyncCwd(parse(process.cwd()).root, home), true);
  assert.equal(isHomeOrRootSyncCwd(join(home, "project"), home), false);
  const previous = process.env.AK_HELPER_HOME;
  process.env.AK_HELPER_HOME = home;
  try {
    assert.equal(resolveHelperHome(), home);
    assert.equal(isHomeOrRootSyncCwd(home), true);
  } finally {
    if (previous === undefined) delete process.env.AK_HELPER_HOME;
    else process.env.AK_HELPER_HOME = previous;
  }
});

test("discovers only the current AgentKit-owned project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-sync-"));
  const project = join(directory, "owned");
  const other = join(directory, "other");
  const home = join(directory, "home");
  const manifest = join(
    project, ".agentkit", "adapters", "codex", "engineer", ".agentkit", "install-manifest.json",
  );
  const otherManifest = join(
    other, ".agentkit", "adapters", "cursor", "engineer", ".agentkit", "install-manifest.json",
  );
  await mkdir(join(manifest, ".."), { recursive: true });
  await mkdir(join(otherManifest, ".."), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(project, ".agentkit", "ownership.json"), '{"version":1,"project_id":"owned"}\n');
  await writeFile(join(other, ".agentkit", "ownership.json"), '{"version":1,"project_id":"other"}\n');
  await writeFile(manifest, '{"version":1,"kit":"engineer"}\n');
  await writeFile(otherManifest, '{"version":1,"kit":"engineer"}\n');
  try {
    const canonical = await realpath(project);
    const found = await discoverSyncProject({
      cwd: project,
      home,
      supportedRuntimes: ["codex", "cursor"],
    });
    assert.equal(found.path, canonical);
    assert.deepEqual(found.installs, [{ kit: "engineer", runtime: "codex" }]);
    assert.equal(await discoverSyncProject({
      cwd: home,
      home,
      supportedRuntimes: ["codex", "cursor"],
    }), null);
    assert.equal(await discoverSyncProject({
      cwd: join(directory, "unowned"),
      home,
      supportedRuntimes: ["codex", "cursor"],
    }), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
