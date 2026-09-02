import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addRecentVpsHost,
  readGlobalHelperConfig,
  readProjectConfig,
  writeGlobalHelperConfig,
  writeProjectConfig,
} from "../lib/config.mjs";

test("round-trips a secret-free project choice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-config-"));
  try {
    const path = await writeProjectConfig(directory, { target: "codex", channel: "beta" });
    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(raw, /path|token|key/i);
    assert.deepEqual(await readProjectConfig(directory), {
      schemaVersion: 1,
      kit: "engineer",
      target: "codex",
      channel: "beta",
      scope: "project",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an unsupported saved contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-config-"));
  try {
    await writeFile(join(directory, ".ak-kit.json"), '{"schemaVersion":2}', "utf8");
    await assert.rejects(() => readProjectConfig(directory), /unsupported helper config contract/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("round-trips a Marketing Kit project choice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-config-"));
  try {
    await writeProjectConfig(directory, {
      kit: "marketing", target: "cursor", channel: "stable",
    });
    assert.equal((await readProjectConfig(directory)).kit, "marketing");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("round-trips multiple project runtimes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-config-"));
  try {
    await writeProjectConfig(directory, {
      kit: "engineer", target: "codex,cursor", channel: "stable",
    });
    assert.equal((await readProjectConfig(directory)).target, "codex,cursor");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts install runtimes but rejects export-only targets in project config", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-config-"));
  try {
    await writeFile(join(directory, ".ak-kit.json"), JSON.stringify({
      schemaVersion: 1,
      kit: "engineer",
      target: "omp",
      channel: "beta",
      scope: "project",
    }), "utf8");
    assert.equal((await readProjectConfig(directory)).target, "omp");

    await writeFile(join(directory, ".ak-kit.json"), JSON.stringify({
      schemaVersion: 1,
      kit: "engineer",
      target: "portable",
      channel: "stable",
      scope: "project",
    }), "utf8");
    await assert.rejects(() => readProjectConfig(directory), /invalid target/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses a symlinked project config without changing its target", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-config-"));
  const external = join(directory, "external.json");
  const project = join(directory, "project");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(project));
  try {
    await writeFile(external, "unchanged\n", "utf8");
    await symlink(external, join(project, ".ak-kit.json"));
    await assert.rejects(
      () => writeProjectConfig(project, { target: "codex", channel: "stable" }),
      /refusing symlinked helper config/,
    );
    assert.equal(await readFile(external, "utf8"), "unchanged\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("round-trips global helper config with capped recent hosts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-global-"));
  try {
    const initial = await readGlobalHelperConfig({ home: directory });
    assert.deepEqual(initial, {
      schemaVersion: 1,
      vps: { defaultHost: null, recentHosts: [] },
    });

    await addRecentVpsHost("user@host1", { home: directory });
    await addRecentVpsHost("user@host2", { home: directory });
    await addRecentVpsHost("user@host1", { home: directory }); // dedupe and bump to front

    const updated = await readGlobalHelperConfig({ home: directory });
    assert.equal(updated.vps.defaultHost, "user@host1");
    assert.deepEqual(updated.vps.recentHosts, ["user@host1", "user@host2"]);

    // Add 10 more to verify cap of 10
    for (let index = 3; index <= 15; index += 1) {
      await addRecentVpsHost(`user@host${index}`, { home: directory });
    }
    const capped = await readGlobalHelperConfig({ home: directory });
    assert.equal(capped.vps.recentHosts.length, 10);
    assert.equal(capped.vps.recentHosts[0], "user@host15");
    assert.equal(capped.vps.defaultHost, "user@host15");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
