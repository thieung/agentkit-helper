import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_TARGETS,
  HELPER_INSTALL_TARGETS,
  HELPER_UPDATE_TARGETS,
  INSTALL_TARGETS,
  isDetectUpdate,
  PROFILE_TARGETS,
  RUNTIME_TARGETS,
  parseArgs,
  UPDATE_TARGETS,
} from "../lib/args.mjs";

test("publishes distinct capability groups", () => {
  assert.deepEqual([...INSTALL_TARGETS], [
    "claude-code", "codex", "cursor", "dsh", "grok", "omp", "pi",
  ]);
  assert.deepEqual([...UPDATE_TARGETS], [
    "claude-code", "codex", "cursor", "dsh", "grok", "omp", "pi",
  ]);
  assert.deepEqual([...PROFILE_TARGETS], ["pi-ak", "pi-omp"]);
  assert.deepEqual([...EXPORT_TARGETS], ["agy", "portable"]);
  assert.deepEqual([...RUNTIME_TARGETS], [...HELPER_INSTALL_TARGETS]);
  assert.equal(HELPER_UPDATE_TARGETS.has("dsh"), true);
  assert.equal(HELPER_UPDATE_TARGETS.has("pi-ak"), true);
  assert.equal(RUNTIME_TARGETS.has("agy"), false);
  assert.equal(RUNTIME_TARGETS.has("portable"), false);
});

test("parses an explicit project install", () => {
  assert.deepEqual(parseArgs([
    "install",
    "--project",
    "/tmp/example",
    "--target",
    "codex",
    "--channel",
    "beta",
    "--yes",
  ]), {
    command: "install",
    project: "/tmp/example",
    global: false,
    target: "codex",
    runtime: null,
    kit: null,
    channel: "beta",
    language: null,
    out: null,
    binaryOnly: false,
    all: false,
    allowDowngrade: false,
    dryRun: false,
    yes: true,
    noSave: false,
    help: false,
    version: false,
    deepScanRoots: [],
    maxDepth: 5,
    maxDepthChanged: false,
    excludes: [],
  });
});

test("rejects ambiguous scope", () => {
  assert.throws(
    () => parseArgs(["install", "--project", "/tmp/example", "--global"]),
    /cannot be used together/,
  );
});

test("rejects binary-only Kit selection", () => {
  assert.throws(
    () => parseArgs(["update", "--binary-only", "--target", "codex"]),
    /cannot be combined/,
  );
});

test("uses separate install and update target matrices", () => {
  assert.equal(parseArgs(["install", "--target", "omp"]).target, "omp");
  assert.equal(parseArgs(["install", "--runtime", "pi"]).runtime, "pi");
  assert.equal(parseArgs(["update", "--target", "omp"]).target, "omp");
  assert.equal(parseArgs(["update", "--target", "pi"]).target, "pi");
  assert.equal(parseArgs(["update", "--target", "dsh"]).target, "dsh");
  assert.equal(parseArgs(["install", "--global", "--target", "pi-ak"]).target, "pi-ak");
  assert.throws(() => parseArgs(["install", "--target", "portable"]), /export-only/);
  assert.throws(() => parseArgs(["install", "--runtime", "portable"]), /export-only/);
  assert.throws(() => parseArgs(["install", "--target", "unknown"]), /unsupported target/);
  assert.throws(() => parseArgs(["install", "--channel", "dev"]), /unsupported channel/);
});

test("accepts comma-separated runtime selections", () => {
  assert.equal(parseArgs(["install", "--target", "codex,cursor"]).target, "codex,cursor");
  assert.equal(parseArgs(["update", "--runtime", "grok,pi"]).runtime, "grok,pi");
  assert.equal(parseArgs(["update", "--target", "codex,dsh"]).target, "codex,dsh");
  assert.throws(
    () => parseArgs(["export", "--target", "agy,portable", "--global"]),
    /install runtime/,
  );
});

test("validates agy and portable as export targets", () => {
  assert.equal(parseArgs(["export", "--target", "agy", "--global"]).target, "agy");
  assert.equal(parseArgs(["export", "--target", "portable", "--out", "/tmp/out"]).out, "/tmp/out");
  assert.throws(() => parseArgs(["export", "--target", "agy"]), /requires --global/);
  assert.throws(
    () => parseArgs(["export", "--target", "agy", "--global", "--out", "/tmp/out"]),
    /not --out/,
  );
  assert.throws(() => parseArgs(["export", "--target", "portable", "--global"]), /uses --out/);
  assert.throws(() => parseArgs(["export", "--target", "codex"]), /install runtime/);
  assert.throws(() => parseArgs(["export", "--runtime", "agy"]), /export-only/);
});

test("accepts runtime as an alias of target", () => {
  assert.deepEqual(parseArgs(["update", "--runtime", "codex", "--channel", "stable"]), {
    command: "update",
    project: null,
    global: false,
    target: null,
    runtime: "codex",
    kit: null,
    channel: "stable",
    language: null,
    out: null,
    binaryOnly: false,
    all: false,
    allowDowngrade: false,
    dryRun: false,
    yes: false,
    noSave: false,
    help: false,
    version: false,
    deepScanRoots: [],
    maxDepth: 5,
    maxDepthChanged: false,
    excludes: [],
  });
});

test("rejects mismatched target and runtime aliases", () => {
  assert.throws(
    () => parseArgs(["update", "--target", "codex", "--runtime", "cursor"]),
    /must match/,
  );
});

test("rejects a runtime alias on binary-only update", () => {
  assert.throws(
    () => parseArgs(["update", "--binary-only", "--runtime", "codex"]),
    /cannot be combined/,
  );
});

test("rejects Kit-specific options on doctor", () => {
  assert.throws(() => parseArgs(["doctor", "--global"]), /doctor accepts only/);
  assert.throws(() => parseArgs(["doctor", "--channel", "beta"]), /doctor accepts only/);
});

test("accepts VI or EN helper language and rejects unknown values", () => {
  assert.equal(parseArgs(["doctor", "--language", "VI"]).language, "vi");
  assert.equal(parseArgs(["doctor", "--language", "en"]).language, "en");
  assert.throws(() => parseArgs(["doctor", "--language", "fr"]), /unsupported language/);
});

test("parses bounded update-all discovery options", () => {
  const options = parseArgs([
    "update-all", "--deep-scan", "~/projects", "--deep-scan", "/work",
    "--max-depth", "7", "--exclude", "archive,vendor", "--exclude", "fixtures",
  ]);
  assert.deepEqual(options.deepScanRoots, ["~/projects", "/work"]);
  assert.equal(options.maxDepth, 7);
  assert.deepEqual(options.excludes, ["archive", "vendor", "fixtures"]);
  assert.throws(() => parseArgs(["install", "--deep-scan", "/work"]), /only with update --all/);
  assert.throws(() => parseArgs(["update-all", "--max-depth", "0"]), /integer from 1 to 20/);
  assert.throws(() => parseArgs(["update-all", "--project", "/work"]), /update-all accepts/);
});

test("supports a dedicated self-update command and preserves binary-only", () => {
  assert.equal(parseArgs(["self-update", "--channel", "stable"]).command, "self-update");
  assert.equal(parseArgs(["update", "--binary-only"]).binaryOnly, true);
  assert.throws(() => parseArgs(["self-update", "--global"]), /self-update accepts/);
  assert.equal(parseArgs([
    "self-update", "--allow-downgrade", "--yes",
  ]).allowDowngrade, true);
  assert.equal(parseArgs([
    "update", "--binary-only", "--allow-downgrade", "--yes",
  ]).allowDowngrade, true);
  assert.throws(
    () => parseArgs(["update", "--allow-downgrade"]),
    /requires update --binary-only/,
  );
  assert.throws(
    () => parseArgs(["install", "--allow-downgrade"]),
    /valid only with self-update/,
  );
});

test("sync infers channel from the binary and rejects scope overrides", () => {
  assert.equal(parseArgs(["sync"]).command, "sync");
  assert.equal(parseArgs(["sync", "--dry-run"]).dryRun, true);
  assert.equal(parseArgs(["sync", "--yes"]).yes, true);
  assert.throws(() => parseArgs(["sync", "--channel", "stable"]), /infers channel/);
  assert.throws(() => parseArgs(["sync", "--project", "/tmp/demo"]), /infers channel/);
  assert.throws(() => parseArgs(["sync", "--global"]), /infers channel/);
  assert.throws(() => parseArgs(["sync", "--deep-scan", "/tmp/demo"]), /infers channel/);
});

test("bare update detects cwd and global installs", () => {
  assert.equal(isDetectUpdate(parseArgs(["update"])), true);
  assert.equal(parseArgs(["update", "--channel", "beta"]).channel, "beta");
  assert.equal(parseArgs(["update", "--all"]).all, true);
  assert.equal(isDetectUpdate(parseArgs(["update", "--all"])), false);
  assert.equal(isDetectUpdate(parseArgs(["update", "--project", "/tmp/demo"])), false);
  assert.throws(() => parseArgs(["update", "--all", "--project", "/tmp/demo"]), /cannot be combined/);
  assert.throws(() => parseArgs(["install", "--all"]), /only with update/);
  assert.deepEqual(parseArgs(["update", "--all", "--deep-scan", "/work"]).deepScanRoots, ["/work"]);
});

test("rejects custom Pi profiles on project scope", () => {
  assert.throws(
    () => parseArgs(["install", "--project", "/tmp/demo", "--target", "pi-ak"]),
    /global profile targets/,
  );
  assert.throws(
    () => parseArgs(["update", "--project", "/tmp/demo", "--target", "pi-omp"]),
    /global profile targets/,
  );
  assert.equal(parseArgs([
    "update", "--global", "--target", "pi-ak,pi-omp",
  ]).target, "pi-ak,pi-omp");
});

test("accepts Marketing Kit for Kit operations", () => {
  assert.equal(parseArgs([
    "install", "--project", "/tmp/demo", "--kit", "marketing",
    "--target", "codex", "--channel", "stable",
  ]).kit, "marketing");
  assert.throws(() => parseArgs([
    "install", "--project", "/tmp/demo", "--kit", "unknown",
  ]), /unsupported kit/);
  assert.throws(() => parseArgs([
    "self-update", "--kit", "marketing", "--channel", "stable",
  ]), /self-update accepts/);
});
