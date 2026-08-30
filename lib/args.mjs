export const COMMANDS = new Set([
  "install", "update", "self-update", "update-all", "export", "doctor", "help",
]);
export const INSTALL_TARGETS = new Set([
  "claude-code", "codex", "cursor", "dsh", "grok", "omp", "pi",
]);
export const UPDATE_TARGETS = new Set([
  "claude-code", "codex", "cursor", "dsh", "grok", "omp", "pi",
]);
export const PROFILE_TARGETS = new Set(["pi-ak", "pi-omp"]);
export const PROFILE_RUNTIME = { "pi-ak": "pi", "pi-omp": "omp" };
export const HELPER_INSTALL_TARGETS = new Set([...INSTALL_TARGETS, ...PROFILE_TARGETS]);
export const HELPER_UPDATE_TARGETS = new Set([...UPDATE_TARGETS, ...PROFILE_TARGETS]);
export const EXPORT_TARGETS = new Set(["agy", "portable"]);
export const RUNTIME_TARGETS = new Set([...HELPER_INSTALL_TARGETS]);
export const KNOWN_TARGETS = new Set([...HELPER_INSTALL_TARGETS, ...EXPORT_TARGETS]);
export const CHANNELS = new Set(["stable", "beta"]);
export const LANGUAGES = new Set(["vi", "en"]);
export const KITS = new Set(["engineer", "marketing"]);

export function splitTargetSpec(value) {
  return String(value || "").split(",").map((target) => target.trim()).filter(Boolean);
}

export function targetSpecIsSupported(value, supportedTargets) {
  const targets = splitTargetSpec(value);
  return targets.length > 0 && targets.every((target) => supportedTargets.has(target));
}

export function specHasProfileTarget(value) {
  return splitTargetSpec(value).some((target) => PROFILE_TARGETS.has(target));
}

export function helperRuntimeTargets({ command, global = false } = {}) {
  const base = command === "update" ? UPDATE_TARGETS : INSTALL_TARGETS;
  return global ? new Set([...base, ...PROFILE_TARGETS]) : new Set(base);
}

export function assertProfileTargetsAreGlobal(options) {
  const selectedTarget = options.target || options.runtime;
  if (specHasProfileTarget(selectedTarget) && options.project) {
    throw new Error("pi-ak and pi-omp are global profile targets; use --global");
  }
}

export function validateForCommand(options) {
  const selectedTarget = options.target || options.runtime;
  const hasDiscoveryOptions = options.deepScanRoots.length > 0 ||
    options.maxDepthChanged || options.excludes.length > 0;
  if (options.command === "doctor") {
    if (
      options.global || selectedTarget || options.kit || options.channel || options.out ||
      options.binaryOnly || options.dryRun || options.noSave || options.allowDowngrade ||
      hasDiscoveryOptions
    ) {
      throw new Error("doctor accepts only --project and shared output flags");
    }
    return;
  }
  if (options.command === "install") {
    if (selectedTarget && !targetSpecIsSupported(selectedTarget, HELPER_INSTALL_TARGETS)) {
      throw new Error(`target ${selectedTarget} is export-only; use the export command`);
    }
    assertProfileTargetsAreGlobal(options);
    if (options.out) throw new Error("--out is valid only with export");
    if (options.allowDowngrade) throw new Error("--allow-downgrade is valid only with self-update or update --binary-only");
    if (hasDiscoveryOptions) throw new Error("deep scan options are valid only with update-all");
    return;
  }
  if (options.command === "update") {
    if (selectedTarget && !targetSpecIsSupported(selectedTarget, HELPER_UPDATE_TARGETS)) {
      throw new Error(`target ${selectedTarget} is not supported by ak update`);
    }
    assertProfileTargetsAreGlobal(options);
    if (options.out) throw new Error("--out is valid only with export");
    if (options.allowDowngrade && !options.binaryOnly) {
      throw new Error("--allow-downgrade requires update --binary-only");
    }
    if (hasDiscoveryOptions) throw new Error("deep scan options are valid only with update-all");
    return;
  }
  if (options.command === "self-update") {
    if (
      options.project || options.global || selectedTarget || options.kit || options.out || options.binaryOnly ||
      options.noSave || hasDiscoveryOptions
    ) {
      throw new Error("self-update accepts --channel and shared output flags only");
    }
    return;
  }
  if (options.command === "update-all") {
    if (
      options.project || options.global || selectedTarget || options.kit || options.out || options.binaryOnly ||
      options.noSave || options.allowDowngrade
    ) {
      throw new Error("update-all accepts discovery, channel, and shared output flags only");
    }
    return;
  }
  if (options.command === "export") {
    if (options.project || options.binaryOnly || options.noSave || options.runtime || options.allowDowngrade) {
      throw new Error("export accepts --target, --global, --out, --channel, and shared output flags");
    }
    if (selectedTarget && !EXPORT_TARGETS.has(selectedTarget)) {
      throw new Error(`target ${selectedTarget} is an install runtime; use the install command`);
    }
    if (selectedTarget === "agy" && !options.global) {
      throw new Error("agy export requires --global");
    }
    if (selectedTarget === "agy" && options.out) {
      throw new Error("agy export uses --global, not --out");
    }
    if (selectedTarget === "portable" && options.global) {
      throw new Error("portable export uses --out, not --global");
    }
    if (hasDiscoveryOptions) throw new Error("deep scan options are valid only with update-all");
  }
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseArgs(argv) {
  const options = {
    command: null,
    project: null,
    global: false,
    target: null,
    runtime: null,
    kit: null,
    channel: null,
    language: null,
    out: null,
    binaryOnly: false,
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
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (!argument.startsWith("-")) {
      if (options.command) {
        throw new Error(`unexpected argument: ${argument}`);
      }
      if (!COMMANDS.has(argument)) {
        throw new Error(`unknown command: ${argument}`);
      }
      options.command = argument;
      continue;
    }

    switch (argument) {
      case "--project":
        options.project = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--global":
        options.global = true;
        break;
      case "--target":
        options.target = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--runtime":
        options.runtime = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--kit":
        options.kit = takeValue(argv, index, argument).toLowerCase();
        index += 1;
        break;
      case "--channel":
        options.channel = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--language":
        options.language = takeValue(argv, index, argument).toLowerCase();
        index += 1;
        break;
      case "--out":
        options.out = takeValue(argv, index, argument);
        index += 1;
        break;
      case "--binary-only":
        options.binaryOnly = true;
        break;
      case "--allow-downgrade":
        options.allowDowngrade = true;
        break;
      case "--deep-scan":
        options.deepScanRoots.push(takeValue(argv, index, argument));
        index += 1;
        break;
      case "--max-depth": {
        const value = Number(takeValue(argv, index, argument));
        if (!Number.isInteger(value) || value < 1 || value > 20) {
          throw new Error("--max-depth must be an integer from 1 to 20");
        }
        options.maxDepth = value;
        options.maxDepthChanged = true;
        index += 1;
        break;
      }
      case "--exclude":
        options.excludes.push(...takeValue(argv, index, argument)
          .split(",").map((value) => value.trim()).filter(Boolean));
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      case "--no-save":
        options.noSave = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
      default:
        throw new Error(`unknown option: ${argument}`);
    }
  }

  validateArgs(options);
  return options;
}

function validateArgs(options) {
  if (options.project && options.global) {
    throw new Error("--project and --global cannot be used together");
  }
  if (options.target && options.runtime && options.target !== options.runtime) {
    throw new Error("--target and --runtime must match when both are provided");
  }
  if (options.target && !targetSpecIsSupported(options.target, KNOWN_TARGETS)) {
    throw new Error(`unsupported target: ${options.target}`);
  }
  if (options.runtime && splitTargetSpec(options.runtime).some((target) => EXPORT_TARGETS.has(target))) {
    throw new Error(`runtime ${options.runtime} is export-only; use --target with the export command`);
  }
  if (options.runtime && !targetSpecIsSupported(options.runtime, RUNTIME_TARGETS)) {
    throw new Error(`unsupported runtime: ${options.runtime}`);
  }
  if (options.channel && !CHANNELS.has(options.channel)) {
    throw new Error(`unsupported channel: ${options.channel}`);
  }
  if (options.language && !LANGUAGES.has(options.language)) {
    throw new Error(`unsupported language: ${options.language}`);
  }
  if (options.kit && !KITS.has(options.kit)) {
    throw new Error(`unsupported kit: ${options.kit}`);
  }
  if (options.binaryOnly && options.command && options.command !== "update") {
    throw new Error("--binary-only is valid only with update");
  }
  if (options.binaryOnly && (options.project || options.global || options.target || options.runtime || options.kit)) {
    throw new Error("--binary-only cannot be combined with project, global, target, or Kit selection");
  }
  validateForCommand(options);
}
