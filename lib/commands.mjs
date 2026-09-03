export function installArgs({ global, target, channel, kit = "engineer" }, { force = false } = {}) {
  return [
    "kit",
    "install",
    kit,
    "--target",
    target,
    ...(global ? ["--global"] : []),
    "--channel",
    channel,
    "--yes",
    ...(force ? ["--force"] : []),
    "--verbose",
  ];
}

export function exportArgs({ global, out, target, channel, kit = "engineer" }) {
  return [
    "kit",
    "install",
    kit,
    "--target",
    target,
    ...(global ? ["--global"] : []),
    ...(out ? ["--out", out] : []),
    "--channel",
    channel,
    "--yes",
    "--verbose",
  ];
}

function updateBase({ global, project, target, channel, kit = "engineer" }) {
  return [
    "update",
    ...(global ? ["--global"] : [project]),
    "--kits",
    kit,
    "--target",
    target,
    "--channel",
    channel,
  ];
}

export function updatePreviewArgs(selection) {
  return [...updateBase(selection), "--show-diff", "--dry-run", "--verbose"];
}

export function updateApplyArgs(selection) {
  return [...updateBase(selection), "--yes", "--verbose"];
}

export function usesKitRefresh(runtime) {
  return runtime === "dsh";
}

export function kitRefreshArgs({
  global, kit = "engineer", channel, target = "dsh",
}) {
  return [
    "kit",
    "refresh",
    kit,
    "--target",
    target,
    ...(global ? ["--global"] : []),
    "--channel",
    channel,
    "--yes",
    "--verbose",
  ];
}

export function updatePreviewArgsForRuntime(selection) {
  return usesKitRefresh(selection.target) ? null : updatePreviewArgs(selection);
}

export function updateApplyArgsForRuntime(selection) {
  return usesKitRefresh(selection.target) ? kitRefreshArgs(selection) : updateApplyArgs(selection);
}

export function splitRuntimesForUpdate(runtimes) {
  return {
    update: runtimes.filter((runtime) => !usesKitRefresh(runtime)),
    refresh: runtimes.filter((runtime) => usesKitRefresh(runtime)),
  };
}

export function selfUpdateCheckArgs(channel) {
  return ["self-update", "--check", "--channel", channel];
}

export function selfUpdateApplyArgs(channel) {
  return ["self-update", "--channel", channel, "--yes"];
}

export function selfUpdateJsonCheckArgs(channel) {
  return [...selfUpdateCheckArgs(channel), "--json"];
}

export function selfUpdateJsonApplyArgs(channel) {
  return [...selfUpdateApplyArgs(channel), "--json"];
}

export function globalUpdatePreviewArgs(channel, targets, kit = "engineer") {
  return [
    "update", "--global", "--kits", kit, "--target", targets.join(","),
    "--channel", channel, "--show-diff", "--dry-run", "--verbose",
  ];
}

export function globalUpdateApplyArgs(channel, targets, kit = "engineer") {
  return [
    "update", "--global", "--kits", kit, "--target", targets.join(","),
    "--channel", channel, "--yes", "--verbose",
  ];
}

export function projectUpdatePreviewArgs(project, target, channel, kit = "engineer") {
  return [
    "update", project, "--kits", kit, "--target", target,
    "--channel", channel, "--show-diff", "--dry-run", "--verbose",
  ];
}

export function projectUpdateApplyArgs(project, target, channel, kit = "engineer") {
  return [
    "update", project, "--kits", kit, "--target", target,
    "--channel", channel, "--yes", "--verbose",
  ];
}

function quote(value) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

function quotePowerShell(value) {
  return /^[A-Za-z0-9_./:@=\\-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "''")}'`;
}

export function formatCommand(binary, args, { platform = process.platform } = {}) {
  const quoteValue = platform === "win32" ? quotePowerShell : quote;
  return [binary, ...args].map(quoteValue).join(" ");
}

export function formatEnvironmentAssignments(
  values,
  { platform = process.platform } = {},
) {
  if (platform === "win32") {
    return Object.entries(values)
      .map(([name, value]) => `$env:${name} = ${quotePowerShell(String(value))};`)
      .join(" ");
  }
  return Object.entries(values)
    .map(([name, value]) => `${name}=${quote(String(value))}`)
    .join(" ");
}

export const REMOTE_PATH_EXPORT = 'export PATH="$HOME/.local/bin:$HOME/.ak/bin:$PATH"';

export function sshInvocationArgs(host, remoteScript, { batchMode = false } = {}) {
  const fullScript = `${REMOTE_PATH_EXPORT}; ${remoteScript}`;
  const remoteCommand = `bash -lc ${quote(fullScript)}`;
  const args = [];
  if (batchMode) {
    args.push("-o", "BatchMode=yes", "-o", "ConnectTimeout=10");
  }
  args.push("--", host, remoteCommand);
  return args;
}

export function formatSshCommand(host, remoteScript, { batchMode = false, sshBinary = "ssh" } = {}) {
  const args = sshInvocationArgs(host, remoteScript, { batchMode });
  return formatCommand(sshBinary, args);
}

export function remoteProbeSnippet() {
  return [
    'echo "===AK_PROBE==="',
    'if command -v ak >/dev/null 2>&1; then',
    '  echo "AK_PATH:$(command -v ak)"',
    '  echo "AK_VERSION:$(ak --version 2>/dev/null || true)"',
    'else',
    '  echo "AK_PATH:"',
    '  echo "AK_VERSION:"',
    'fi',
    'for r in claude-code codex cursor dsh grok omp pi; do',
    '  for k in engineer marketing; do',
    '    if [ -f "$HOME/.agentkit/adapters/$r/$k/.agentkit/install-manifest.json" ]; then',
    '      echo "INSTALLED:$k:$r"',
    '    fi',
    '  done',
    'done',
  ].join("\n");
}
