import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { isUnsafeProjectPath, linkedNativeDestination, resolveProjectPath } from "../lib/project.mjs";

test("filesystem root and home are not inferred as projects", () => {
  const home = "/tmp/example-home";
  assert.equal(isUnsafeProjectPath(parse(process.cwd()).root, home), true);
  assert.equal(isUnsafeProjectPath(home, home), true);
  assert.equal(isUnsafeProjectPath(join(home, "project"), home), false);
});

test("accepts an explicit existing project directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-project-"));
  try {
    assert.equal(await resolveProjectPath(directory), await realpath(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("detects a project-root AGENTS.md symlink", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-agents-"));
  try {
    assert.equal(await linkedNativeDestination(directory, "AGENTS.md"), null);
    await writeFile(join(directory, "CLAUDE.md"), "hello\n");
    await writeFile(join(directory, "AGENTS.md"), "regular\n");
    assert.equal(await linkedNativeDestination(directory, "AGENTS.md"), null);
    await rm(join(directory, "AGENTS.md"));
    await symlink("CLAUDE.md", join(directory, "AGENTS.md"));
    assert.equal(await linkedNativeDestination(directory, "AGENTS.md"), join(directory, "AGENTS.md"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a project symlink that resolves to filesystem root", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-project-"));
  const link = join(directory, "root-link");
  try {
    await symlink(parse(directory).root, link);
    await assert.rejects(() => resolveProjectPath(link), /resolves to/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
