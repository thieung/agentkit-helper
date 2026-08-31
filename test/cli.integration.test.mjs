import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "bin/agentkit-helper.mjs");

function runCli(args, env, cwd = root) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: {
        ...process.env,
        AK_HELPER_PPM_BIN: "pi-profile-manager-not-installed-for-test",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolveRun({ code, stdout, stderr }));
  });
}

test("package exposes both npm binary names", () => {
  assert.deepEqual(packageJson.bin, {
    "agentkit-helper": "bin/agentkit-helper.mjs",
    "akh": "bin/agentkit-helper.mjs",
  });
});

test("bare interactive mode fails closed outside a TTY", async () => {
  const result = await runCli([], { AK_HELPER_AK_BIN: "ak-not-needed" });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /interactive input is unavailable/);
  assert.match(result.stderr, /pass explicit flags and --yes/);
});

test("install and update delegate exact lifecycle commands to ak", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-cli-"));
  const project = join(directory, "project");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  const state = join(directory, "ak-version");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(project));
  const canonicalProject = await realpath(project);
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
const current = existsSync(process.env.AK_HELPER_TEST_STATE) ? "2.15.0-beta.3" : "2.14.0";
if (args[0] === "--version") process.stdout.write("ak " + current + "\\n");
if (args.includes("--json") && !args.includes("--check")) {
  writeFileSync(process.env.AK_HELPER_TEST_STATE, "2.15.0-beta.3\\n");
}
if (args.includes("--json")) process.stdout.write(JSON.stringify({
  schema_version: 1, kind: "self_update", data: {
    available: args.includes("--check") && current !== "2.15.0-beta.3",
    status: args.includes("--check") && current !== "2.15.0-beta.3" ? "update-available" : "current",
    current_version: current, latest_version: "2.15.0-beta.3", channel: "beta",
    applied: !args.includes("--check"),
  },
}));
`, "utf8");
  await chmod(fakeAk, 0o755);

  const env = {
    AK_HELPER_AK_BIN: fakeAk,
    AK_HELPER_TEST_LOG: log,
    AK_HELPER_TEST_STATE: state,
  };
  try {
    const installed = await runCli([
      "install", "--project", project, "--target", "codex", "--channel", "beta", "--yes",
    ], env);
    assert.equal(installed.code, 0, installed.stderr);
    assert.match(installed.stderr, /Installing a beta Kit with --yes may update the ak binary to beta/);

    const updated = await runCli(["update", "--project", project, "--yes"], env);
    assert.equal(updated.code, 0, updated.stderr);

    const marketingInstalled = await runCli([
      "install", "--project", project, "--kit", "marketing",
      "--target", "cursor", "--channel", "beta", "--yes",
    ], env);
    assert.equal(marketingInstalled.code, 0, marketingInstalled.stderr);
    const marketingUpdated = await runCli(["update", "--project", project, "--yes"], env);
    assert.equal(marketingUpdated.code, 0, marketingUpdated.stderr);

    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["self-update", "--channel", "beta", "--yes", "--json"],
      ["--version"],
      ["kit", "install", "engineer", "--target", "codex", "--channel", "beta", "--yes", "--verbose"],
      ["projects", "add", canonicalProject, "--yes"],
      ["--version"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "codex", "--channel", "beta", "--show-diff", "--dry-run", "--verbose"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "codex", "--channel", "beta", "--yes", "--verbose"],
      ["--version"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["kit", "install", "marketing", "--target", "cursor", "--channel", "beta", "--yes", "--verbose"],
      ["projects", "add", canonicalProject, "--yes"],
      ["--version"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["update", canonicalProject, "--kits", "marketing", "--target", "cursor", "--channel", "beta", "--show-diff", "--dry-run", "--verbose"],
      ["update", canonicalProject, "--kits", "marketing", "--target", "cursor", "--channel", "beta", "--yes", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project update runs multiple selected runtimes as valid sequential ak commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-multi-update-"));
  const project = join(directory, "project");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(project));
  const canonicalProject = await realpath(project);
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.14.0\\n");
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "update", "--project", project, "--target", "codex,cursor",
      "--channel", "stable", "--dry-run", "--yes",
    ], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
    });
    assert.equal(result.code, 0, result.stderr);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "codex", "--channel", "stable", "--show-diff", "--dry-run", "--verbose"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "cursor", "--channel", "stable", "--show-diff", "--dry-run", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("multi-runtime install runs one official ak invocation per runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-multi-install-"));
  const project = join(directory, "project");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(project));
  const canonicalProject = await realpath(project);
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.14.0\\n");
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "install", "--project", project, "--target", "grok,omp,pi",
      "--channel", "stable", "--yes",
    ], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
    });
    assert.equal(result.code, 0, result.stderr);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["kit", "install", "engineer", "--target", "grok", "--channel", "stable", "--yes", "--verbose"],
      ["kit", "install", "engineer", "--target", "omp", "--channel", "stable", "--yes", "--verbose"],
      ["kit", "install", "engineer", "--target", "pi", "--channel", "stable", "--yes", "--verbose"],
      ["projects", "add", canonicalProject, "--yes"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ak failures run verbose but show only a short useful summary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-verbose-error-"));
  const project = join(directory, "project");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(project));
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") {
  process.stdout.write("ak 2.14.0\\n");
} else if (args[0] === "kit") {
  process.stderr.write("main failure\\ncontext two\\ncontext three\\ncontext four\\nhidden fifth line\\n");
  process.exitCode = 1;
}
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "install", "--project", project, "--target", "grok,omp,pi",
      "--channel", "stable", "--yes",
    ], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /LỖI|ERROR/);
    assert.match(result.stderr, /main failure[\s\S]*context four/);
    assert.doesNotMatch(result.stderr, /hidden fifth line/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls[1].slice(-2), ["--yes", "--verbose"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project omp install fails closed when AGENTS.md is a symlink", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-omp-link-"));
  const project = join(directory, "project");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(project));
  await writeFile(join(project, "CLAUDE.md"), "hello\n");
  await symlink("CLAUDE.md", join(project, "AGENTS.md"));
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.14.0\\n");
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "install", "--project", project, "--target", "omp",
      "--channel", "stable", "--yes",
    ], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
    });
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /symlink/);
    assert.match(result.stderr, /AGENTS\.md/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [["--version"]]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("maps ak linked native destination failures without filing a helper issue class", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-omp-map-"));
  const project = join(directory, "project");
  const fakeAk = join(directory, "ak-fake.mjs");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(project));
  await writeFile(fakeAk, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("ak 2.14.0\\n");
} else if (args[0] === "kit") {
  process.stderr.write('Error: init: emit target "omp" failed: omp: unsafe native destination "/tmp/project/AGENTS.md": fsutil: path traversal rejected: linked path component /tmp/project/AGENTS.md\\n');
  process.exitCode = 1;
}
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "install", "--project", project, "--target", "omp",
      "--channel", "stable", "--yes",
    ], { AK_HELPER_AK_BIN: fakeAk });
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /symlink/);
    assert.match(result.stderr, /\/tmp\/project\/AGENTS\.md/);
    assert.doesNotMatch(result.stderr, /path traversal rejected/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("non-interactive install never turns --yes into force consent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-force-consent-"));
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") {
  process.stdout.write("ak 2.14.0\\n");
} else if (args[0] === "kit") {
  process.stderr.write("Error: init: target directory already exists; re-run with --force to overwrite\\n");
  process.exitCode = 6;
}
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "install", "--global", "--target", "omp", "--channel", "stable", "--yes",
    ], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
    });
    assert.equal(result.code, 6);
    assert.match(result.stderr, /separate interactive confirmation/);
    assert.match(result.stderr, /user-installed or modified Skills/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["kit", "install", "engineer", "--target", "omp", "--global", "--channel", "stable", "--yes", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dedicated self-update delegates only the signed binary lifecycle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-self-update-"));
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args.includes("--json")) process.stdout.write(JSON.stringify({
  schema_version: 1, kind: "self_update", data: {
    available: args.includes("--check"), status: args.includes("--check") ? "update-available" : "current",
    current_version: "2.13.0", latest_version: "2.14.0", channel: "stable",
    applied: !args.includes("--check"),
  },
}));
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "self-update", "--channel", "stable", "--yes",
    ], { AK_HELPER_AK_BIN: fakeAk, AK_HELPER_TEST_LOG: log }, parse(process.cwd()).root);
    assert.equal(result.code, 0, result.stderr);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["self-update", "--check", "--channel", "stable", "--json"],
      ["self-update", "--channel", "stable", "--yes", "--json"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit downgrade uses the official installer only after separate consent", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-downgrade-"));
  const fakeAk = join(directory, "ak-fake.mjs");
  const fakeCurl = join(directory, "curl-fake.mjs");
  const fakeSh = join(directory, "sh-fake.mjs");
  const state = join(directory, "installed-version");
  const log = join(directory, "ak.log");
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
const current = existsSync(process.env.AK_HELPER_TEST_STATE)
  ? readFileSync(process.env.AK_HELPER_TEST_STATE, "utf8").trim()
  : "2.15.0-beta.3";
if (args[0] === "--version") process.stdout.write("ak " + current + "\\n");
if (args.includes("--json")) process.stdout.write(JSON.stringify({
  schema_version: 1, kind: "self_update", data: {
    available: false, status: "current", current_version: current,
    latest_version: "2.14.0", channel: "stable", applied: false,
  },
}));
`, "utf8");
  await writeFile(fakeCurl, `#!/usr/bin/env node
process.stdout.write("# verified installer fixture\\n");
`, "utf8");
  await writeFile(fakeSh, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
process.stdin.resume();
process.stdin.on("end", () => {
  writeFileSync(process.env.AK_HELPER_TEST_STATE, process.env.AK_VERSION + "\\n");
});
`, "utf8");
  await Promise.all([fakeAk, fakeCurl, fakeSh].map((path) => chmod(path, 0o755)));
  const env = {
    AK_HELPER_AK_BIN: fakeAk,
    AK_HELPER_CURL_BIN: fakeCurl,
    AK_HELPER_SH_BIN: fakeSh,
    AK_HELPER_TEST_LOG: log,
    AK_HELPER_TEST_STATE: state,
  };
  try {
    const refused = await runCli([
      "self-update", "--channel", "stable", "--yes",
    ], env);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /WARNING: stable 2\.14\.0 is older/);
    assert.match(refused.stderr, /--allow-downgrade and --yes/);

    const accepted = await runCli([
      "self-update", "--channel", "stable", "--allow-downgrade", "--yes",
    ], env);
    assert.equal(accepted.code, 0, accepted.stderr);
    assert.match(accepted.stdout, /Downgrade complete/);
    assert.equal((await readFile(state, "utf8")).trim(), "2.14.0");
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["self-update", "--check", "--channel", "stable", "--json"],
      ["--version"],
      ["self-update", "--check", "--channel", "stable", "--json"],
      ["--version"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("update-all inventories global and registered Kit installs before sequential updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-update-all-"));
  const project = join(directory, "project");
  const akHome = join(directory, "home", ".agentkit");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  const projectManifest = join(
    project, ".agentkit", "adapters", "codex", "engineer", ".agentkit", "install-manifest.json",
  );
  const globalManifest = join(
    akHome, "adapters", "cursor", "engineer", ".agentkit", "install-manifest.json",
  );
  const projectMarketingManifest = join(
    project, ".agentkit", "adapters", "codex", "marketing", ".agentkit", "install-manifest.json",
  );
  const globalMarketingManifest = join(
    akHome, "adapters", "grok", "marketing", ".agentkit", "install-manifest.json",
  );
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    mkdir(dirname(projectManifest), { recursive: true }),
    mkdir(dirname(globalManifest), { recursive: true }),
    mkdir(dirname(projectMarketingManifest), { recursive: true }),
    mkdir(dirname(globalMarketingManifest), { recursive: true }),
  ]));
  await writeFile(join(project, ".agentkit", "ownership.json"), '{"version":1,"project_id":"demo"}\n');
  await writeFile(projectManifest, '{"version":1,"kit":"engineer"}\n');
  await writeFile(globalManifest, '{"version":1,"kit":"engineer"}\n');
  await writeFile(projectMarketingManifest, '{"version":1,"kit":"marketing"}\n');
  await writeFile(globalMarketingManifest, '{"version":1,"kit":"marketing"}\n');
  const canonicalProject = await realpath(project);
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.15.0-beta.5\\n");
if (args[0] === "self-update" && args.includes("--json")) {
  process.stdout.write(JSON.stringify({
    schema_version: 1, kind: "self_update", data: {
      available: false, status: "current",
      current_version: "2.15.0-beta.5", latest_version: "2.15.0-beta.5",
      channel: "beta", applied: false,
    },
  }));
}
if (args.join(" ") === "projects list --json") {
  process.stdout.write(JSON.stringify({
    schema_version: 1,
    kind: "projects.list",
    data: { projects: [{ name: "demo", dir: process.env.AK_HELPER_TEST_PROJECT }], total: 1 },
  }));
}
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "update-all", "--channel", "beta", "--yes",
    ], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
      AK_HELPER_TEST_PROJECT: project,
      AGENTKIT_HOME: akHome,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Detected update inventory/);
    assert.match(result.stdout, /Engineer Kit global scope \(cursor\)/);
    assert.match(result.stdout, /Marketing Kit global scope \(grok\)/);
    assert.match(result.stdout, /demo — Marketing Kit \(codex\)/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["projects", "list", "--json"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["update", "--global", "--kits", "engineer", "--target", "cursor", "--channel", "beta", "--show-diff", "--dry-run", "--verbose"],
      ["update", "--global", "--kits", "marketing", "--target", "grok", "--channel", "beta", "--show-diff", "--dry-run", "--verbose"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "codex", "--channel", "beta", "--show-diff", "--dry-run", "--verbose"],
      ["update", canonicalProject, "--kits", "marketing", "--target", "codex", "--channel", "beta", "--show-diff", "--dry-run", "--verbose"],
      ["update", "--global", "--kits", "engineer", "--target", "cursor", "--channel", "beta", "--yes", "--verbose"],
      ["update", "--global", "--kits", "marketing", "--target", "grok", "--channel", "beta", "--yes", "--verbose"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "codex", "--channel", "beta", "--yes", "--verbose"],
      ["update", canonicalProject, "--kits", "marketing", "--target", "codex", "--channel", "beta", "--yes", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("update-all upgrades an already-beta ak before Kit previews", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-stale-beta-"));
  const project = join(directory, "project");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  const state = join(directory, "ak-version");
  const manifest = join(
    project, ".agentkit", "adapters", "claude-code", "engineer", ".agentkit", "install-manifest.json",
  );
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(manifest), { recursive: true }));
  await writeFile(join(project, ".agentkit", "ownership.json"), '{"version":1,"project_id":"demo"}\n');
  await writeFile(manifest, '{"version":1,"kit":"engineer"}\n');
  const canonicalProject = await realpath(project);
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
const current = existsSync(process.env.AK_HELPER_TEST_STATE) ? "2.15.0-beta.5" : "2.13.0-beta.12";
if (args[0] === "--version") process.stdout.write("ak " + current + "\\n");
if (args[0] === "self-update" && args.includes("--json")) {
  if (!args.includes("--check")) writeFileSync(process.env.AK_HELPER_TEST_STATE, "2.15.0-beta.5\\n");
  process.stdout.write(JSON.stringify({
    schema_version: 1, kind: "self_update", data: {
      available: args.includes("--check") && current !== "2.15.0-beta.5",
      status: args.includes("--check") && current !== "2.15.0-beta.5" ? "update-available" : "current",
      current_version: current, latest_version: "2.15.0-beta.5", channel: "beta",
      applied: !args.includes("--check"),
    },
  }));
}
if (args.join(" ") === "projects list --json") {
  process.stdout.write(JSON.stringify({
    schema_version: 1, kind: "projects.list",
    data: { projects: [{ name: "demo", dir: process.env.AK_HELPER_TEST_PROJECT }], total: 1 },
  }));
}
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "update-all", "--channel", "beta", "--yes",
    ], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
      AK_HELPER_TEST_STATE: state,
      AK_HELPER_TEST_PROJECT: project,
      AGENTKIT_HOME: join(directory, "empty-home", ".agentkit"),
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Binary prerequisite complete/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["projects", "list", "--json"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["self-update", "--channel", "beta", "--yes", "--json"],
      ["--version"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "claude-code", "--channel", "beta", "--show-diff", "--dry-run", "--verbose"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "claude-code", "--channel", "beta", "--yes", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("update-all treats each verified Pi profile as an isolated global target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-pi-profiles-"));
  const akHome = join(directory, "home", ".agentkit");
  const fakeAk = join(directory, "ak-fake.mjs");
  const fakePpm = join(directory, "ppm-fake.mjs");
  const log = join(directory, "ak.log");
  const agentDir = join(directory, "profiles", "pi-ak");
  const sessionDir = join(agentDir, "sessions");
  await writeFile(fakePpm, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ schemaVersion: 1, profiles: [{
  id: "pi-ak", runtime: "pi",
  agentDir: process.env.AK_HELPER_TEST_AGENT_DIR,
  sessionDir: process.env.AK_HELPER_TEST_SESSION_DIR,
  agentkitEnabled: true, managed: true, healthy: true,
}] }));
`, "utf8");
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify({
  args,
  agentDir: process.env.PI_CODING_AGENT_DIR || null,
  sessionDir: process.env.PI_CODING_AGENT_SESSION_DIR || null,
}) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.14.0\\n");
if (args.join(" ") === "projects list --json") {
  process.stdout.write(JSON.stringify({
    schema_version: 1, kind: "projects.list", data: { projects: [], total: 0 },
  }));
}
`, "utf8");
  await Promise.all([chmod(fakeAk, 0o755), chmod(fakePpm, 0o755)]);
  try {
    const result = await runCli(["update-all", "--channel", "stable", "--yes"], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_PPM_BIN: fakePpm,
      AK_HELPER_TEST_LOG: log,
      AK_HELPER_TEST_AGENT_DIR: agentDir,
      AK_HELPER_TEST_SESSION_DIR: sessionDir,
      AGENTKIT_HOME: akHome,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Engineer Kit — pi profile: pi-ak/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    const updates = calls.filter(({ args }) => args[0] === "update");
    assert.equal(updates.length, 2);
    assert.deepEqual(updates.map(({ agentDir: value }) => value), [agentDir, agentDir]);
    assert.deepEqual(updates.map(({ sessionDir: value }) => value), [sessionDir, sessionDir]);
    assert.ok(updates.every(({ args }) => args.includes("--global") && args.includes("pi")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("update-all deep scan finds an unregistered owned project and dry-run never applies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-deep-scan-"));
  const scanRoot = join(directory, "projects");
  const project = join(scanRoot, "unregistered");
  const manifest = join(
    project, ".agentkit", "adapters", "grok", "engineer", ".agentkit", "install-manifest.json",
  );
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(manifest), { recursive: true }));
  await writeFile(join(project, ".agentkit", "ownership.json"), '{"version":1,"project_id":"unregistered"}\n');
  await writeFile(manifest, '{"version":1,"kit":"engineer"}\n');
  const canonicalProject = await realpath(project);
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args.join(" ") === "projects list --json") {
  process.stdout.write('{"schema_version":1,"kind":"projects.list","data":{"projects":[],"total":0}}');
}
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "update-all", "--channel", "stable", "--deep-scan", scanRoot,
      "--max-depth", "3", "--dry-run", "--yes",
    ], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
      AGENTKIT_HOME: join(directory, "empty-home", ".agentkit"),
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /unregistered — Engineer Kit \(grok\)/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["projects", "list", "--json"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "grok", "--channel", "stable", "--show-diff", "--dry-run", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sync one-shot uses the binary channel and current owned project only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-sync-"));
  const project = join(directory, "project");
  const other = join(directory, "other");
  const home = join(directory, "home");
  const akHome = join(home, ".agentkit");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  const projectManifest = join(
    project, ".agentkit", "adapters", "codex", "engineer", ".agentkit", "install-manifest.json",
  );
  const otherManifest = join(
    other, ".agentkit", "adapters", "cursor", "engineer", ".agentkit", "install-manifest.json",
  );
  const globalManifest = join(
    akHome, "adapters", "grok", "engineer", ".agentkit", "install-manifest.json",
  );
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    mkdir(dirname(projectManifest), { recursive: true }),
    mkdir(dirname(otherManifest), { recursive: true }),
    mkdir(dirname(globalManifest), { recursive: true }),
  ]));
  await writeFile(join(project, ".agentkit", "ownership.json"), '{"version":1,"project_id":"demo"}\n');
  await writeFile(join(other, ".agentkit", "ownership.json"), '{"version":1,"project_id":"other"}\n');
  await writeFile(projectManifest, '{"version":1,"kit":"engineer"}\n');
  await writeFile(otherManifest, '{"version":1,"kit":"engineer"}\n');
  await writeFile(globalManifest, '{"version":1,"kit":"engineer"}\n');
  const canonicalProject = await realpath(project);
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.15.0-beta.5\\n");
if (args[0] === "self-update" && args.includes("--json")) {
  process.stdout.write(JSON.stringify({
    schema_version: 1, kind: "self_update", data: {
      available: false, status: "current",
      current_version: "2.15.0-beta.5", latest_version: "2.15.0-beta.5",
      channel: "beta", applied: false,
    },
  }));
}
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli(["sync"], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
      AGENTKIT_HOME: akHome,
      AK_HELPER_HOME: home,
      HOME: home,
    }, project);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Using installed ak channel: beta/);
    assert.match(result.stdout, /Engineer Kit global scope \(grok\)/);
    assert.match(result.stdout, /project — Engineer Kit \(codex\)/);
    assert.doesNotMatch(result.stdout, /other — Engineer Kit/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["update", "--global", "--kits", "engineer", "--target", "grok", "--channel", "beta", "--yes", "--verbose"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "codex", "--channel", "beta", "--yes", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sync dry-run from home skips project Kits and never applies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-sync-home-"));
  const home = join(directory, "home");
  const akHome = join(home, ".agentkit");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  const globalManifest = join(
    akHome, "adapters", "cursor", "engineer", ".agentkit", "install-manifest.json",
  );
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    mkdir(dirname(globalManifest), { recursive: true }),
    mkdir(join(home, ".agentkit", "adapters", "codex", "engineer", ".agentkit"), { recursive: true }),
  ]));
  await writeFile(join(home, ".agentkit", "ownership.json"), '{"version":1,"project_id":"home"}\n');
  await writeFile(
    join(home, ".agentkit", "adapters", "codex", "engineer", ".agentkit", "install-manifest.json"),
    '{"version":1,"kit":"engineer"}\n',
  );
  await writeFile(globalManifest, '{"version":1,"kit":"engineer"}\n');
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.14.0\\n");
if (args[0] === "self-update" && args.includes("--json")) {
  process.stdout.write(JSON.stringify({
    schema_version: 1, kind: "self_update", data: {
      available: false, status: "current",
      current_version: "2.14.0", latest_version: "2.14.0",
      channel: "stable", applied: false,
    },
  }));
}
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli(["sync", "--dry-run"], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
      AGENTKIT_HOME: akHome,
      AK_HELPER_HOME: home,
      HOME: home,
    }, home);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /home or filesystem root/);
    assert.doesNotMatch(result.stdout, /Current project Kits/);
    assert.doesNotMatch(result.stdout, /home — Engineer Kit \(codex\)/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["self-update", "--check", "--channel", "stable", "--json"],
      ["update", "--global", "--kits", "engineer", "--target", "codex,cursor", "--channel", "stable", "--show-diff", "--dry-run", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sync from home updates every globally installed runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-sync-globals-"));
  const home = join(directory, "home");
  const akHome = join(home, ".agentkit");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  const engineerRuntimes = ["claude-code", "codex", "cursor", "dsh", "grok", "omp", "pi"];
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    ...engineerRuntimes.map((runtime) => mkdir(
      join(akHome, "adapters", runtime, "engineer", ".agentkit"),
      { recursive: true },
    )),
    mkdir(join(akHome, "adapters", "cursor", "marketing", ".agentkit"), { recursive: true }),
  ]));
  await Promise.all(engineerRuntimes.map((runtime) => writeFile(
    join(akHome, "adapters", runtime, "engineer", ".agentkit", "install-manifest.json"),
    '{"version":1,"kit":"engineer"}\n',
  )));
  await writeFile(
    join(akHome, "adapters", "cursor", "marketing", ".agentkit", "install-manifest.json"),
    '{"version":1,"kit":"marketing"}\n',
  );
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.14.0\\n");
if (args[0] === "self-update" && args.includes("--json")) {
  process.stdout.write(JSON.stringify({
    schema_version: 1, kind: "self_update", data: {
      available: false, status: "current",
      current_version: "2.14.0", latest_version: "2.14.0",
      channel: "stable", applied: false,
    },
  }));
}
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli(["sync"], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
      AGENTKIT_HOME: akHome,
      AK_HELPER_HOME: home,
      HOME: home,
    }, home);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /every globally installed runtime/);
    assert.match(result.stdout, /Engineer Kit global scope \(claude-code, codex, cursor, dsh, grok, omp, pi\)/);
    assert.match(result.stdout, /Marketing Kit global scope \(cursor\)/);
    assert.doesNotMatch(result.stdout, /Current project Kits/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["self-update", "--check", "--channel", "stable", "--json"],
      ["update", "--global", "--kits", "engineer", "--target", "claude-code,codex,cursor,grok,omp,pi", "--channel", "stable", "--yes", "--verbose"],
      ["kit", "refresh", "engineer", "--target", "dsh", "--global", "--channel", "stable", "--yes", "--verbose"],
      ["update", "--global", "--kits", "marketing", "--target", "cursor", "--channel", "stable", "--yes", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sync applies a binary update on the installed channel before Kits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-sync-bin-"));
  const project = join(directory, "project");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  const state = join(directory, "ak-version");
  const manifest = join(
    project, ".agentkit", "adapters", "claude-code", "engineer", ".agentkit", "install-manifest.json",
  );
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(manifest), { recursive: true }));
  await writeFile(join(project, ".agentkit", "ownership.json"), '{"version":1,"project_id":"demo"}\n');
  await writeFile(manifest, '{"version":1,"kit":"engineer"}\n');
  const canonicalProject = await realpath(project);
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
const current = existsSync(process.env.AK_HELPER_TEST_STATE) ? "2.15.0-beta.5" : "2.13.0-beta.12";
if (args[0] === "--version") process.stdout.write("ak " + current + "\\n");
if (args[0] === "self-update" && args.includes("--json")) {
  if (!args.includes("--check")) writeFileSync(process.env.AK_HELPER_TEST_STATE, "2.15.0-beta.5\\n");
  process.stdout.write(JSON.stringify({
    schema_version: 1, kind: "self_update", data: {
      available: args.includes("--check") && current !== "2.15.0-beta.5",
      status: args.includes("--check") && current !== "2.15.0-beta.5" ? "update-available" : "current",
      current_version: current, latest_version: "2.15.0-beta.5", channel: "beta",
      applied: !args.includes("--check"),
    },
  }));
}
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli(["sync"], {
      AK_HELPER_AK_BIN: fakeAk,
      AK_HELPER_TEST_LOG: log,
      AK_HELPER_TEST_STATE: state,
      AGENTKIT_HOME: join(directory, "empty-home", ".agentkit"),
      HOME: join(directory, "empty-home"),
    }, project);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Binary update complete/);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["self-update", "--channel", "beta", "--yes", "--json"],
      ["--version"],
      ["update", canonicalProject, "--kits", "engineer", "--target", "claude-code", "--channel", "beta", "--yes", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("export delegates agy and portable without treating them as runtimes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-export-"));
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  const out = join(directory, "portable-output");
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.15.0-beta.5\\n");
if (args.includes("--json")) process.stdout.write(JSON.stringify({
  schema_version: 1, kind: "self_update", data: {
    available: false, status: "current",
    current_version: "2.15.0-beta.5", latest_version: "2.15.0-beta.5",
    channel: "beta", applied: false,
  },
}));
`, "utf8");
  await chmod(fakeAk, 0o755);

  const env = { AK_HELPER_AK_BIN: fakeAk, AK_HELPER_TEST_LOG: log };
  try {
    const agy = await runCli([
      "export", "--target", "agy", "--global", "--channel", "beta", "--yes",
    ], env);
    assert.equal(agy.code, 0, agy.stderr);

    const portable = await runCli([
      "export", "--target", "portable", "--out", out, "--channel", "stable", "--yes",
    ], env);
    assert.equal(portable.code, 0, portable.stderr);

    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["kit", "install", "engineer", "--target", "agy", "--global", "--channel", "beta", "--yes", "--verbose"],
      ["--version"],
      ["kit", "install", "engineer", "--target", "portable", "--out", out, "--channel", "stable", "--yes", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("global and binary-only updates work from the root directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-binary-"));
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.15.0-beta.5\\n");
if (args.includes("--json")) {
  const beta = args.includes("beta");
  process.stdout.write(JSON.stringify({
    schema_version: 1, kind: "self_update", data: {
      available: args.includes("--check") && !beta,
      status: args.includes("--check") && !beta ? "update-available" : "current",
      current_version: "2.15.0-beta.5",
      latest_version: beta ? "2.15.0-beta.5" : "2.14.0",
      channel: beta ? "beta" : "stable",
      applied: !args.includes("--check"),
    },
  }));
}
`, "utf8");
  await chmod(fakeAk, 0o755);

  try {
    const globalResult = await runCli([
      "update", "--global", "--runtime", "codex", "--channel", "beta", "--yes",
    ], { AK_HELPER_AK_BIN: fakeAk, AK_HELPER_TEST_LOG: log }, parse(process.cwd()).root);
    assert.equal(globalResult.code, 0, globalResult.stderr);

    const binaryResult = await runCli([
      "update", "--binary-only", "--channel", "stable", "--yes",
    ], { AK_HELPER_AK_BIN: fakeAk, AK_HELPER_TEST_LOG: log }, parse(process.cwd()).root);
    assert.equal(binaryResult.code, 0, binaryResult.stderr);

    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["update", "--global", "--kits", "engineer", "--target", "codex", "--channel", "beta", "--show-diff", "--dry-run", "--verbose"],
      ["update", "--global", "--kits", "engineer", "--target", "codex", "--channel", "beta", "--yes", "--verbose"],
      ["--version"],
      ["self-update", "--check", "--channel", "stable", "--json"],
      ["self-update", "--channel", "stable", "--yes", "--json"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("saved project dsh updates through kit refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-config-update-"));
  const project = join(directory, "project");
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(project));
  await writeFile(join(project, ".ak-kit.json"), JSON.stringify({
    schemaVersion: 1,
    kit: "engineer",
    target: "dsh",
    channel: "beta",
    scope: "project",
  }), "utf8");
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.15.0-beta.6\\n");
if (args.includes("--json")) process.stdout.write(JSON.stringify({
  schema_version: 1, kind: "self_update", data: {
    available: false, status: "current", current_version: "2.15.0-beta.6",
    latest_version: "2.15.0-beta.6", channel: "beta", applied: false,
  },
}));
`, "utf8");
  await chmod(fakeAk, 0o755);

  try {
    const result = await runCli([
      "update", "--project", project, "--yes",
    ], { AK_HELPER_AK_BIN: fakeAk, AK_HELPER_TEST_LOG: log });
    assert.equal(result.code, 0, result.stderr);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["self-update", "--check", "--channel", "beta", "--json"],
      ["kit", "refresh", "engineer", "--target", "dsh", "--channel", "beta", "--yes", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("global dsh updates through kit refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-dsh-global-"));
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.14.0\\n");
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "update", "--global", "--target", "dsh", "--channel", "stable", "--yes",
    ], { AK_HELPER_AK_BIN: fakeAk, AK_HELPER_TEST_LOG: log });
    assert.equal(result.code, 0, result.stderr);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      ["--version"],
      ["kit", "refresh", "engineer", "--target", "dsh", "--global", "--channel", "stable", "--yes", "--verbose"],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("global pi-ak install isolates the Pi profile home", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentkit-helper-pi-ak-install-"));
  const fakeAk = join(directory, "ak-fake.mjs");
  const log = join(directory, "ak.log");
  await writeFile(fakeAk, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.AK_HELPER_TEST_LOG, JSON.stringify({
  args,
  agentDir: process.env.PI_CODING_AGENT_DIR || null,
}) + "\\n");
if (args[0] === "--version") process.stdout.write("ak 2.14.0\\n");
`, "utf8");
  await chmod(fakeAk, 0o755);
  try {
    const result = await runCli([
      "install", "--global", "--target", "pi-ak", "--channel", "stable", "--yes",
    ], { AK_HELPER_AK_BIN: fakeAk, AK_HELPER_TEST_LOG: log });
    assert.equal(result.code, 0, result.stderr);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    const installs = calls.filter(({ args }) => args[0] === "kit");
    assert.equal(installs.length, 1);
    assert.deepEqual(installs[0].args, [
      "kit", "install", "engineer", "--target", "pi", "--global", "--channel", "stable", "--yes", "--verbose",
    ]);
    assert.match(installs[0].agentDir, /pi-ak$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
