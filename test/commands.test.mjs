import test from "node:test";
import assert from "node:assert/strict";
import {
  exportArgs,
  formatCommand,
  globalUpdateApplyArgs,
  globalUpdatePreviewArgs,
  installArgs,
  projectUpdateApplyArgs,
  projectUpdatePreviewArgs,
  updateApplyArgs,
  updatePreviewArgs,
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
