import test from "node:test";
import assert from "node:assert/strict";
import { requiresForceConsent, summarizeCommandFailure } from "../lib/runner.mjs";

test("extracts the main message from a JSON command error", () => {
  assert.equal(summarizeCommandFailure("", JSON.stringify({
    error: { message: "registry artifact is unavailable" },
    diagnostics: { internal: "detail" },
  })), "registry artifact is unavailable");
});

test("extracts a JSON error from mixed NDJSON diagnostics", () => {
  assert.equal(summarizeCommandFailure(
    '{"action":"install","status":"preview"}',
    '[i] resolving source\n{"schema_version":1,"error":"init: lifecycle preflight: incompatible runtime","error_code":"install_failed","exit_code":1}',
  ), "incompatible runtime");
});

test("prefers and shortens the explicit human error line", () => {
  const summary = summarizeCommandFailure("", [
    "[i] Installing engineer to /tmp/project",
    "Error: init: lifecycle preflight: remote install supports one runtime target per invocation; run separate installs for claude-code, codex, cursor, grok, omp, and pi",
  ].join("\n"));
  assert.equal(summary, "remote install supports one runtime target per invocation; run separate installs for claude-code, codex, cursor, grok, omp, and pi");
});

test("limits human command errors to useful leading lines", () => {
  const output = `╭─ Error ─╮
│ Command failed.
│ ownership manifest is invalid
│ expected version 1
│ detail three
│ detail four
│ detail five
│ → Re-run with --verbose for diagnostic details.
╰─────────╯`;
  assert.equal(summarizeCommandFailure("", output), [
    "ownership manifest is invalid",
    "expected version 1",
    "detail three",
    "detail four",
  ].join("\n"));
});

test("requires separate force consent only for overwrite or drift failures", () => {
  assert.equal(requiresForceConsent({ exitCode: 6, message: "command failed" }), true);
  assert.equal(requiresForceConsent({
    exitCode: 1,
    message: "target directory already exists; re-run with --force",
  }), true);
  assert.equal(requiresForceConsent({
    exitCode: 1,
    message: "network unavailable",
  }), false);
});
