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

export function formatCommand(binary, args) {
  return [binary, ...args].map(quote).join(" ");
}
