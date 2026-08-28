import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIssueReport,
  checkIssueRepository,
  createGitHubIssue,
  findDuplicateIssue,
  isReportableAkError,
  redact,
  resolveIssueRepository,
} from "../lib/github-issue.mjs";

test("only reports failures thrown by the configured ak binary", () => {
  const helperValidationError = new Error("deep scan root is too broad: /Users/demo");
  const akError = Object.assign(new Error("ak exited with status 1"), {
    command: { binary: "/custom/bin/ak", args: ["update"], cwd: "/project" },
  });
  const installerError = Object.assign(new Error("curl exited with status 1"), {
    command: { binary: "curl", args: [], cwd: "/project" },
  });

  assert.equal(isReportableAkError(helperValidationError, "/custom/bin/ak"), false);
  assert.equal(isReportableAkError(akError, "/custom/bin/ak"), true);
  assert.equal(isReportableAkError(installerError, "/custom/bin/ak"), false);
});

test("redacts project, home, and common credential formats", () => {
  const input = "/private/project /Users/demo ghp_abcdef token=secret Bearer hidden";
  const result = redact(input, { cwd: "/private/project", home: "/Users/demo" });
  assert.equal(result, "$PROJECT $HOME [REDACTED] token=[REDACTED] Bearer [REDACTED]");
});

test("does not treat filesystem root as a project path during redaction", () => {
  const input = "See /tmp/run.log and https://github.com/thieung/agentkit-helper/issues/new";
  const result = redact(input, { cwd: "/", home: "/Users/demo" });
  assert.equal(result, input);
});

test("builds a minimal report without raw output", () => {
  const error = new Error("failed in /private/project with github_pat_secret");
  error.exitCode = 6;
  error.command = {
    binary: "/Users/demo/.local/bin/ak",
    args: ["update", "/private/project", "--yes"],
    cwd: "/private/project",
  };
  const report = buildIssueReport({
    error,
    helperVersion: "0.1.0",
    action: "update",
    language: "vi",
    cwd: error.command.cwd,
  });

  assert.equal(report.title, "[bug] update failed with exit 6");
  assert.doesNotMatch(report.body, /\/private\/project|github_pat_secret/);
  assert.match(report.body, /\$PROJECT|\[REDACTED\]/);
  assert.match(report.body, /Verbose ak stdout\/stderr/);
});

test("includes redacted verbose ak diagnostics in the issue report", () => {
  const error = Object.assign(new Error("install failed"), {
    exitCode: 1,
    command: { binary: "ak", args: ["kit", "install", "--verbose"], cwd: "/private/project" },
    stderr: "verbose failure in /private/project token=secret",
    stdout: "resolved from /Users/demo/cache",
  });
  const report = buildIssueReport({
    error, helperVersion: "0.1.0", action: "install", language: "vi", cwd: "/private/project",
  });
  assert.match(report.body, /Redacted ak diagnostics/);
  assert.match(report.body, /verbose failure in \$PROJECT token=\[REDACTED\]/);
  assert.doesNotMatch(report.body, /\/private\/project|token=secret/);
});

test("checks duplicates before creating an issue and sends body on stdin", async () => {
  const report = { title: "[bug] install failed with exit 1", body: "safe body" };
  const calls = [];
  const execute = async (binary, args, options = {}) => {
    calls.push({ binary, args, options });
    if (args[1] === "list") return "[]";
    return "https://github.com/thieung/agentkit-helper/issues/1";
  };

  assert.equal(await findDuplicateIssue(report, { ghBinary: "gh-fake", execute }), null);
  const url = await createGitHubIssue(report, { ghBinary: "gh-fake", execute });

  assert.equal(url, "https://github.com/thieung/agentkit-helper/issues/1");
  assert.deepEqual(calls[0].args.slice(0, 5), ["issue", "list", "--repo", "thieung/agentkit-helper", "--state"]);
  assert.deepEqual(calls[1].args.slice(0, 5), ["issue", "create", "--repo", "thieung/agentkit-helper", "--title"]);
  assert.equal(calls[1].options.input, "safe body");
});

test("checks repository availability and supports an explicit issue destination", async () => {
  const calls = [];
  const execute = async (binary, args) => {
    calls.push({ binary, args });
    return '{"nameWithOwner":"owner/support"}';
  };
  const repository = resolveIssueRepository({ AK_HELPER_ISSUE_REPO: "owner/support" });
  assert.equal(repository, "owner/support");
  assert.equal(await checkIssueRepository({ repository, ghBinary: "gh-fake", execute }), repository);
  assert.deepEqual(calls[0], {
    binary: "gh-fake",
    args: ["repo", "view", "owner/support", "--json", "nameWithOwner"],
  });
  assert.throws(
    () => resolveIssueRepository({ AK_HELPER_ISSUE_REPO: "invalid" }),
    /owner\/repository/,
  );
});

test("returns an exact-title duplicate", async () => {
  const report = { title: "[bug] doctor failed with exit 1", body: "safe" };
  const execute = async () => JSON.stringify([
    { title: report.title, url: "https://github.com/thieung/agentkit-helper/issues/2" },
  ]);
  assert.deepEqual(await findDuplicateIssue(report, { execute }), {
    title: report.title,
    url: "https://github.com/thieung/agentkit-helper/issues/2",
  });
});
