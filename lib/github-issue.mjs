import { homedir } from "node:os";
import { spawn } from "node:child_process";

export const DEFAULT_ISSUE_REPO = "thieung/agentkit-helper";

export function resolveIssueRepository(env = process.env) {
  const repository = (env.AK_HELPER_ISSUE_REPO || DEFAULT_ISSUE_REPO).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("AK_HELPER_ISSUE_REPO must use owner/repository format");
  }
  return repository;
}

export function issueUrl(repository = resolveIssueRepository()) {
  return `https://github.com/${repository}/issues/new`;
}

export function isReportableAkError(error, akBinary = "ak") {
  return error?.command?.binary === akBinary;
}

function replaceAllLiteral(value, needle, replacement) {
  return needle ? value.split(needle).join(replacement) : value;
}

function isRedactablePath(value) {
  return typeof value === "string" && value.length > 1;
}

export function redact(value, { cwd = process.cwd(), home = homedir() } = {}) {
  let result = String(value ?? "");
  if (isRedactablePath(cwd)) {
    result = replaceAllLiteral(result, cwd, "$PROJECT");
  }
  if (isRedactablePath(home)) {
    result = replaceAllLiteral(result, home, "$HOME");
  }
  result = result
    .replace(/\b(?:gh[opusr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g, "[REDACTED]")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 [REDACTED]")
    .replace(/\b(token|api[_-]?key|secret|password)=\S+/gi, "$1=[REDACTED]");
  return result;
}

export function buildIssueReport({ error, helperVersion, action, language, cwd = process.cwd() }) {
  const exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  const command = error?.command
    ? [error.command.binary, ...error.command.args].join(" ")
    : "Unavailable";
  const safeAction = action || "startup";
  const title = `[bug] ${safeAction} failed with exit ${exitCode}`;
  const rawDiagnostics = [error?.stderr, error?.stdout].filter(Boolean).join("\n\n");
  const redactedDiagnostics = rawDiagnostics
    ? redact(rawDiagnostics, { cwd }).replaceAll("```", "` ` `")
    : "";
  const maxDiagnostics = 20_000;
  const diagnostics = redactedDiagnostics.length > maxDiagnostics
    ? `${redactedDiagnostics.slice(0, maxDiagnostics)}\n\n[diagnostics truncated]`
    : redactedDiagnostics;
  const body = `## Summary

AgentKit Helper failed while running \`${safeAction}\`.

## Diagnostics

- Helper: ${helperVersion}
- Node: ${process.version}
- Platform: ${process.platform} ${process.arch}
- UI language: ${language}
- Exit code: ${exitCode}
- Error: ${redact(error?.message || "Unknown error", { cwd })}
- Command: \`${redact(command, { cwd })}\`

${diagnostics ? `## Redacted ak diagnostics

\`\`\`text
${diagnostics}
\`\`\`

` : ""}## Privacy

Verbose ak stdout/stderr is included only after redacting home/project paths and common credential formats. Diagnostics are capped at ${maxDiagnostics} characters.
`;
  return { title, body };
}

function runProcess(binary, args, { input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        const error = new Error(stderr.trim() || `${binary} exited with status ${code}`);
        error.exitCode = code || 1;
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
    child.stdin.end(input);
  });
}

export async function checkIssueRepository({
  repository = resolveIssueRepository(), ghBinary = "gh", execute = runProcess,
} = {}) {
  await execute(ghBinary, ["repo", "view", repository, "--json", "nameWithOwner"]);
  return repository;
}

export async function findDuplicateIssue(report, {
  repository = resolveIssueRepository(), ghBinary = "gh", execute = runProcess,
} = {}) {
  const output = await execute(ghBinary, [
    "issue", "list", "--repo", repository, "--state", "all",
    "--search", `\"${report.title}\" in:title`, "--limit", "1", "--json", "title,url",
  ]);
  const issues = JSON.parse(output || "[]");
  return issues.find((issue) => issue.title === report.title) || null;
}

export async function createGitHubIssue(report, {
  repository = resolveIssueRepository(), ghBinary = "gh", execute = runProcess,
} = {}) {
  return execute(ghBinary, [
    "issue", "create", "--repo", repository,
    "--title", report.title, "--body-file", "-",
  ], { input: report.body });
}
