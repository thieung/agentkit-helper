import test from "node:test";
import assert from "node:assert/strict";
import {
  exportArgs,
  formatCommand,
  formatSshCommand,
  globalUpdateApplyArgs,
  globalUpdatePreviewArgs,
  formatEnvironmentAssignments,
  installArgs,
  kitRefreshArgs,
  projectUpdateApplyArgs,
  projectUpdatePreviewArgs,
  REMOTE_PATH_EXPORT,
  splitRuntimesForUpdate,
  sshInvocationArgs,
  updateApplyArgs,
  updateApplyArgsForRuntime,
  updatePreviewArgs,
  updatePreviewArgsForRuntime,
} from "../lib/commands.mjs";

test("builds export commands separately from runtime installs", () => {
  assert.deepEqual(exportArgs({
    global: true, out: null, target: "agy", channel: "beta",
  }), [
    "kit", "install", "engineer", "--target", "agy", "--global", "--channel", "beta", "--yes", "--verbose",
  ]);
  assert.deepEqual(exportArgs({
    global: false, out: "/tmp/export", target: "portable", channel: "stable",
  }), [
    "kit", "install", "engineer", "--target", "portable", "--out", "/tmp/export",
    "--channel", "stable", "--yes", "--verbose",
  ]);
});

test("defaults update-all command builders to Engineer Kit", () => {
  assert.deepEqual(globalUpdatePreviewArgs("beta", ["codex", "cursor"]), [
    "update", "--global", "--kits", "engineer", "--target", "codex,cursor",
    "--channel", "beta", "--show-diff", "--dry-run", "--verbose",
  ]);
  assert.deepEqual(globalUpdateApplyArgs("beta", ["codex", "cursor"]), [
    "update", "--global", "--kits", "engineer", "--target", "codex,cursor",
    "--channel", "beta", "--yes", "--verbose",
  ]);
  assert.deepEqual(projectUpdatePreviewArgs("/tmp/demo", "grok", "stable"), [
    "update", "/tmp/demo", "--kits", "engineer", "--target", "grok",
    "--channel", "stable", "--show-diff", "--dry-run", "--verbose",
  ]);
  assert.deepEqual(projectUpdateApplyArgs("/tmp/demo", "grok", "stable"), [
    "update", "/tmp/demo", "--kits", "engineer", "--target", "grok",
    "--channel", "stable", "--yes", "--verbose",
  ]);
});

test("builds a project install without hidden scope defaults", () => {
  assert.deepEqual(installArgs({ global: false, target: "codex", channel: "stable" }), [
    "kit", "install", "engineer", "--target", "codex", "--channel", "stable", "--yes", "--verbose",
  ]);
});

test("builds explicit global install", () => {
  assert.deepEqual(installArgs({ global: true, target: "claude-code", channel: "beta" }), [
    "kit", "install", "engineer", "--target", "claude-code", "--global", "--channel", "beta", "--yes", "--verbose",
  ]);
  assert.deepEqual(installArgs({
    global: true, target: "claude-code", channel: "beta",
  }, { force: true }), [
    "kit", "install", "engineer", "--target", "claude-code", "--global", "--channel", "beta", "--yes", "--force", "--verbose",
  ]);
});

test("passes Marketing Kit through install, update, and export commands", () => {
  assert.deepEqual(installArgs({
    global: false, kit: "marketing", target: "codex", channel: "stable",
  }).slice(0, 4), ["kit", "install", "marketing", "--target"]);
  assert.match(formatCommand("ak", updateApplyArgs({
    global: false,
    project: "/tmp/demo",
    kit: "marketing",
    target: "cursor",
    channel: "beta",
  })), /--kits marketing/);
  assert.deepEqual(exportArgs({
    global: false,
    out: "/tmp/export",
    kit: "marketing",
    target: "portable",
    channel: "stable",
  }).slice(0, 4), ["kit", "install", "marketing", "--target"]);
});

test("builds preview and apply commands for one project route", () => {
  const selection = {
    global: false,
    project: "/tmp/project with spaces",
    target: "cursor",
    channel: "stable",
  };
  assert.deepEqual(updatePreviewArgs(selection).slice(-3), ["--show-diff", "--dry-run", "--verbose"]);
  assert.deepEqual(updateApplyArgs(selection).slice(-2), ["--yes", "--verbose"]);
  assert.match(formatCommand("ak", updateApplyArgs(selection)), /'\/tmp\/project with spaces'/);
});

test("formats command plans and environment overrides for PowerShell", () => {
  assert.equal(formatCommand("ak", ["update", "C:\\work folder", "--yes"], {
    platform: "win32",
  }), "ak update 'C:\\work folder' --yes");
  assert.equal(formatEnvironmentAssignments({
    PI_CODING_AGENT_DIR: "C:\\Users\\Me\\Pi Profile",
  }, { platform: "win32" }), "$env:PI_CODING_AGENT_DIR = 'C:\\Users\\Me\\Pi Profile';");
});

test("routes dsh updates through kit refresh instead of ak update", () => {
  const project = {
    global: false, project: "/tmp/demo", target: "dsh", channel: "beta", kit: "engineer",
  };
  const global = {
    global: true, project: null, target: "dsh", channel: "stable", kit: "engineer",
  };
  assert.equal(updatePreviewArgsForRuntime(project), null);
  assert.deepEqual(updateApplyArgsForRuntime(project), [
    "kit", "refresh", "engineer", "--target", "dsh", "--channel", "beta", "--yes", "--verbose",
  ]);
  assert.deepEqual(kitRefreshArgs(global), [
    "kit", "refresh", "engineer", "--target", "dsh", "--global", "--channel", "stable",
    "--yes", "--verbose",
  ]);
  assert.deepEqual(splitRuntimesForUpdate(["codex", "dsh", "pi"]), {
    update: ["codex", "pi"],
    refresh: ["dsh"],
  });
});

test("formats remote SSH invocations with pinned bash -lc, BatchMode, and remote PATH export", () => {
  assert.match(REMOTE_PATH_EXPORT, /export PATH="\$HOME\/\.local\/bin:\$HOME\/\.ak\/bin:\$PATH"/);

  const script = "ak kit install engineer --target codex --global";
  const defaultArgs = sshInvocationArgs("user@vps", script);
  assert.equal(defaultArgs.length, 3);
  assert.equal(defaultArgs[0], "--");
  assert.equal(defaultArgs[1], "user@vps");
  assert.match(defaultArgs[2], /^bash -lc '/);
  assert.match(defaultArgs[2], /export PATH="\$HOME\/\.local\/bin:\$HOME\/\.ak\/bin:\$PATH"; ak kit install/);

  const batchArgs = sshInvocationArgs("user@vps", script, { batchMode: true });
  assert.deepEqual(batchArgs.slice(0, 4), ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]);
  assert.equal(batchArgs[4], "--");
  assert.equal(batchArgs[5], "user@vps");
  assert.equal(batchArgs[6], defaultArgs[2]);

  const formatted = formatSshCommand("user@vps", script);
  assert.match(formatted, /^ssh -- user@vps 'bash -lc /);
});
