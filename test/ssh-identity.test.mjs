import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSshIdentityFiles, resolveIdentityPath } from "../lib/ssh-identity.mjs";

const PEM = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n";

test("lists well-known and PEM identity files and skips junk", async () => {
  const home = await mkdtemp(join(tmpdir(), "agentkit-helper-ssh-id-"));
  const sshDir = join(home, ".ssh");
  await mkdir(sshDir);
  try {
    await writeFile(join(sshDir, "id_ed25519"), PEM, { mode: 0o600 });
    await writeFile(join(sshDir, "id_ed25519.pub"), "ssh-ed25519 AAAA comment\n", { mode: 0o644 });
    await writeFile(join(sshDir, "id_rsa"), PEM, { mode: 0o600 });
    await writeFile(join(sshDir, "deploy_key"), PEM, { mode: 0o600 });
    await writeFile(join(sshDir, "config"), "Host *\n", { mode: 0o600 });
    await writeFile(join(sshDir, "known_hosts"), "host ssh-ed25519 AAAA\n", { mode: 0o644 });
    await writeFile(join(sshDir, "authorized_keys"), "ssh-ed25519 AAAA\n", { mode: 0o600 });
    await writeFile(join(sshDir, "notes.txt"), "not a key\n", { mode: 0o644 });
    await symlink(join(sshDir, "id_ed25519"), join(sshDir, "linked_key"));

    const listed = await listSshIdentityFiles({ home });
    assert.deepEqual(listed, [
      join(sshDir, "id_ed25519"),
      join(sshDir, "id_rsa"),
      join(sshDir, "deploy_key"),
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("returns an empty list when ~/.ssh is missing", async () => {
  const home = await mkdtemp(join(tmpdir(), "agentkit-helper-ssh-missing-"));
  try {
    assert.deepEqual(await listSshIdentityFiles({ home }), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("returns an empty list when ~/.ssh is not a directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "agentkit-helper-ssh-file-"));
  try {
    await writeFile(join(home, ".ssh"), "not a directory\n");
    assert.deepEqual(await listSshIdentityFiles({ home }), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("resolves identity paths including home shortcuts", () => {
  assert.equal(resolveIdentityPath(""), "");
  assert.equal(resolveIdentityPath("~/id", { home: "/home/dev" }), join("/home/dev", "id"));
  assert.equal(resolveIdentityPath("keys/id", { cwd: "/tmp/proj" }), join("/tmp/proj", "keys/id"));
});
