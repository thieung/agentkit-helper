#!/usr/bin/env node

import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPORT_TARGETS,
  helperRuntimeTargets,
  KITS,
  parseArgs,
  PROFILE_TARGETS,
  specHasProfileTarget,
  splitTargetSpec,
  targetSpecIsSupported,
  UPDATE_TARGETS,
  validateForCommand,
} from "../lib/args.mjs";
import {
  exportArgs,
  formatCommand,
  formatEnvironmentAssignments,
  globalUpdateApplyArgs,
  globalUpdatePreviewArgs,
  installArgs,
  kitRefreshArgs,
  projectUpdateApplyArgs,
  projectUpdatePreviewArgs,
  selfUpdateCheckArgs,
  selfUpdateApplyArgs,
  selfUpdateJsonApplyArgs,
  selfUpdateJsonCheckArgs,
  splitRuntimesForUpdate,
  updateApplyArgsForRuntime,
  updatePreviewArgsForRuntime,
  usesKitRefresh,
} from "../lib/commands.mjs";
import { readProjectConfig, writeProjectConfig } from "../lib/config.mjs";
import { colorText } from "../lib/colors.mjs";
import {
  discoverGlobalKitInstalls,
  discoverProjectCandidates,
} from "../lib/discovery.mjs";
import {
  buildIssueReport,
  checkIssueRepository,
  createGitHubIssue,
  findDuplicateIssue,
  isReportableAkError,
  resolveIssueRepository,
} from "../lib/github-issue.mjs";
import { t } from "../lib/i18n.mjs";
import { isUnsafeProjectPath, linkedNativeDestination, resolveProjectPath } from "../lib/project.mjs";
import {
  classifyPiProfiles,
  materializeHelperTarget,
  parsePiProfileInventory,
  piProfileManagerInvocation,
  piProfileProcessOptions,
} from "../lib/pi-profiles.mjs";
import { BACK, walkSelections } from "../lib/navigation.mjs";
import {
  ask,
  askDirectory,
  choose,
  chooseWithBack,
  confirm,
  finishInteractive,
  multiChoose,
  multiChooseWithBack,
  PromptCancelledError,
  setPromptCopy,
  warning,
  withSpinner,
} from "../lib/prompts.mjs";
import {
  ensureAk,
  isLinkedNativeDestinationError,
  linkedNativeDestinationPath,
  requiresForceConsent,
  run,
  runCapture,
  runPipeline,
} from "../lib/runner.mjs";
import {
  assertInstallerVersion,
  classifySelfUpdate,
  parseSelfUpdateOutput,
  releaseChannelForVersion,
} from "../lib/self-update.mjs";
import {
  discoverSyncProject,
  isHomeOrRootSyncCwd,
  resolveCanonicalHome,
  syncChannelFromBinary,
} from "../lib/sync.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
const akBinary = process.env.AK_HELPER_AK_BIN || "ak";
const ghBinary = process.env.AK_HELPER_GH_BIN || "gh";
const piProfileManager = piProfileManagerInvocation(
  process.env.AK_HELPER_PPM_BIN || "pi-profile-manager",
);
const installerUrl = "https://agentkit.best/install.sh";
const windowsInstallerUrl = "https://agentkit.best/install.ps1";
let activeLanguage = "en";
let activeAction = null;
let installedAkVersion = "";
let binaryUpdateAvailable = false;

function ui(key, values) {
  return t(activeLanguage, key, values);
}

function showCurrentBinary() {
  const version = installedAkVersion.replace(/^ak\s+/i, "");
  process.stdout.write(`${colorText(`│  ${ui("currentBinary", {
    version,
    channel: releaseChannelForVersion(installedAkVersion) || "stable",
  })}`, "binary")}\n`);
}

function usage(language = "en") {
  if (language === "vi") {
    process.stdout.write(`AgentKit Helper ${metadata.version}

Cách dùng:
  agentkit-helper install [tùy chọn]
  agentkit-helper update [tùy chọn]
  agentkit-helper self-update [tùy chọn]
  agentkit-helper update-all [tùy chọn]
  agentkit-helper sync [tùy chọn]
  agentkit-helper export [tùy chọn]
  agentkit-helper doctor [--project <đường-dẫn>]

Tùy chọn:
  --project <đường-dẫn>  Dùng project scope tại đường dẫn này
  --global               Dùng scope user/global của runtime
  --target <targets>     Các runtime phân cách dấu phẩy cho install/update, hoặc một export target
  --runtime <runtimes>   Alias của --target nhưng chỉ cho runtime install/update
  --kit <kit>            engineer hoặc marketing
  --channel <channel>    stable hoặc beta
  --language <vi|en>     Ngôn ngữ giao diện helper
  --out <đường-dẫn>      Thư mục output cho portable export
  --binary-only          Chỉ cập nhật binary ak
  --allow-downgrade      Cho phép downgrade khi dùng cùng --yes
  --deep-scan <thư-mục> Deep scan thư mục cha (có thể lặp lại; chỉ update-all)
  --max-depth <1-20>     Độ sâu deep scan, mặc định 5
  --exclude <tên,...>   Bỏ qua thêm các tên thư mục khi deep scan
  --dry-run              Lập kế hoạch/xem trước, không thay đổi
  --yes, -y              Bỏ qua bước xác nhận của helper
  --no-save              Không ghi .ak-kit.json
  --help, -h             Hiện trợ giúp
  --version, -v          Hiện phiên bản

Target groups:
  Install                claude-code, codex, cursor, dsh, grok, omp, pi, pi-ak, pi-omp
  Update                 claude-code, codex, cursor, dsh, grok, omp, pi, pi-ak, pi-omp
  Export                 agy, portable
`);
    return;
  }
  process.stdout.write(`AgentKit Helper ${metadata.version}

Usage:
  agentkit-helper install [options]
  agentkit-helper update [options]
  agentkit-helper self-update [options]
  agentkit-helper update-all [options]
  agentkit-helper sync [options]
  agentkit-helper export [options]
  agentkit-helper doctor [--project <path>]

Options:
  --project <path>       Use project scope at this path
  --global               Use the runtime user/global scope
  --target <targets>     Comma-separated runtimes for install/update, or one export target
  --runtime <runtimes>   Alias of --target for install/update runtimes only
  --kit <kit>            engineer or marketing
  --channel <channel>    stable or beta
  --language <vi|en>     Helper interface language
  --out <path>           Output directory for portable export
  --binary-only          Update only the ak binary
  --allow-downgrade      Permit downgrade when also used with --yes
  --deep-scan <path>     Deep scan a parent path (repeatable; update-all only)
  --max-depth <1-20>     Deep scan depth, default 5
  --exclude <name,...>   Additional directory names to skip during deep scan
  --dry-run              Plan or preview without mutation
  --yes, -y              Skip helper confirmation
  --no-save              Do not write .ak-kit.json
  --help, -h             Show help
  --version, -v          Show version

Target groups:
  Install                claude-code, codex, cursor, dsh, grok, omp, pi, pi-ak, pi-omp
  Update                 claude-code, codex, cursor, dsh, grok, omp, pi, pi-ak, pi-omp
  Export                 agy, portable
`);
}

function printPlan(args, cwd, envOverrides = {}) {
  const suffix = cwd && cwd !== process.cwd() ? `  (cwd: ${cwd})` : "";
  const environment = formatEnvironmentAssignments(envOverrides);
  const prefix = environment ? `${environment} ` : "";
  process.stdout.write(`${colorText(`  ${prefix}${formatCommand(akBinary, args)}${suffix}`, "command")}\n`);
}

function printSection(message) {
  process.stdout.write(`\n${colorText(message, "section")}\n`);
}

async function assertOmpNativeDestinations(selection) {
  if (selection.global || selection.kind === "global" || selection.kind === "profile") {
    return;
  }
  const target = selection.target || selection.runtime;
  if (target !== "omp") return;
  const project = selection.project || selection.path;
  if (!project) return;
  const linked = await linkedNativeDestination(project, "AGENTS.md");
  if (!linked) return;
  throw new Error(ui("linkedNativeDestination", { path: linked }));
}

function helperErrorMessage(error) {
  if (!isLinkedNativeDestinationError(error)) return error.message;
  return ui("linkedNativeDestination", {
    path: linkedNativeDestinationPath(error) || "AGENTS.md",
  });
}

async function runAkCommand(
  args,
  { cwd = process.cwd(), envOverrides = {}, envUnset = [] } = {},
) {
  const result = await withSpinner(
    ui("runningAkCommand"),
    ui("akCommandComplete"),
    () => runCapture(akBinary, args, { cwd, envOverrides, envUnset }),
  );
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
}

async function checkInteractiveBinaryUpdate() {
  const channel = releaseChannelForVersion(installedAkVersion) || "stable";
  try {
    const result = await withSpinner(
      ui("checkingBinaryUpdate"),
      ui("checkedBinaryUpdate"),
      () => runCapture(akBinary, selfUpdateJsonCheckArgs(channel)),
    );
    const check = parseSelfUpdateOutput(result.stdout);
    const classification = classifySelfUpdate(check);
    binaryUpdateAvailable = classification === "update";
    if (binaryUpdateAvailable) {
      warning(`│  ${ui("binaryUpdateAvailable", {
        current: check.current_version,
        latest: check.latest_version,
        channel: check.channel || channel,
      })}`);
    } else if (classification === "current") {
      process.stdout.write(`${colorText(`│  ${ui("binaryUpToDate", {
        version: check.current_version,
        channel: check.channel || channel,
      })}`, "binary")}\n`);
    } else {
      warning(`│  ${ui("binaryUpdateStatusUnknown", { status: check.status })}`);
    }
  } catch (error) {
    binaryUpdateAvailable = false;
    warning(`│  ${ui("binaryUpdateCheckFailed", { message: error.message })}`);
  }
}

async function chooseCommand(allowLanguageBack = false) {
  const choices = [
    { label: ui("syncAction"), value: "sync" },
    { label: ui("selfUpdateAction"), value: "self-update" },
    { label: ui("installAction"), value: "install" },
    { label: ui("updateAction"), value: "update" },
    { label: ui("updateAllAction"), value: "update-all" },
    { label: ui("exportAction"), value: "export" },
    { label: ui("doctorAction"), value: "doctor" },
  ];
  const defaultIndex = 0;
  return allowLanguageBack
    ? chooseWithBack(ui("commandPrompt"), choices, defaultIndex, ui("escapeBack"))
    : choose(ui("commandPrompt"), choices, defaultIndex);
}

function kitName(kit) {
  return ui(kit === "marketing" ? "marketingKit" : "engineerKit");
}

async function selectKit(options, config, allowBack = false, forcePrompt = false) {
  if (options.kit) return options.kit;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return config?.kit || "engineer";
  if (config?.kit && !forcePrompt) return config.kit;
  return chooseLocalized(allowBack, ui("kitPrompt"), [...KITS].map((kit) => ({
    label: kitName(kit),
    value: kit,
  })));
}

async function selectLanguage(options, forcePrompt = false) {
  if (options.language && !forcePrompt) return options.language;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return "en";
  return choose(t("en", "languagePrompt"), [
    { label: "Tiếng Việt", value: "vi" },
    { label: "English", value: "en" },
  ]);
}

function chooseLocalized(allowBack, message, choices, defaultIndex = 0) {
  return allowBack
    ? chooseWithBack(message, choices, defaultIndex, ui("escapeBack"))
    : choose(message, choices, defaultIndex);
}

function supportedList(targets) {
  return [...targets].join(", ");
}

function needsScopePrompt(options) {
  return !options.binaryOnly && !options.global && !options.project && (
    (process.stdin.isTTY && process.stdout.isTTY) || isUnsafeProjectPath(process.cwd())
  );
}

async function selectScope(command, options, allowBack = false) {
  if (options.binaryOnly) {
    return { binaryOnly: true, global: false, project: null };
  }
  if (options.global) {
    return { binaryOnly: false, global: true, project: null };
  }
  if (options.project) {
    return {
      binaryOnly: false,
      global: false,
      project: await resolveProjectPath(options.project),
    };
  }
  const currentProjectIsSafe = !isUnsafeProjectPath(process.cwd());
  if (currentProjectIsSafe && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    return {
      binaryOnly: false,
      global: false,
      project: await resolveProjectPath(null),
    };
  }

  const choices = [
    ...(currentProjectIsSafe ? [{
      label: ui("currentProjectScope", { path: process.cwd() }),
      value: "current-project",
    }] : []),
    { label: ui("chooseProject"), value: "project" },
    { label: ui("globalScope"), value: "global" },
  ];
  if (command === "update") {
    choices.unshift({ label: ui("binaryScope"), value: "binary" });
  }
  const scope = await chooseLocalized(
    allowBack,
    currentProjectIsSafe ? ui("scopePrompt") : ui("unsafeCwd", { cwd: process.cwd() }),
    choices,
  );
  if (scope === BACK) return BACK;
  if (scope === "current-project") {
    return {
      binaryOnly: false,
      global: false,
      project: await resolveProjectPath(null),
    };
  }
  if (scope === "binary") {
    return { binaryOnly: true, global: false, project: null };
  }
  if (scope === "global") {
    return { binaryOnly: false, global: true, project: null };
  }
  return {
    binaryOnly: false,
    global: false,
    project: await resolveProjectPath(await askDirectory(ui("projectDirectory"), { root: homedir() })),
  };
}

async function selectTarget(
  options,
  config,
  targets,
  promptKey,
  allowBack = false,
  forcePrompt = false,
  promptValues = {},
) {
  if (options.target) return options.target;
  if (options.runtime) return options.runtime;
  if (config?.target && targetSpecIsSupported(config.target, targets) && !forcePrompt) {
    return config.target;
  }
  const allRuntimeValue = "__all_runtimes__";
  const choices = [
    { label: ui("allRuntimes"), value: allRuntimeValue },
    ...[...targets].map((target) => ({
      label: target === "pi-ak" ? ui("piAkProfile") : target === "pi-omp" ? ui("piOmpProfile") : target,
      value: target,
    })),
  ];
  const initialValues = [];
  const selected = await (allowBack ? multiChooseWithBack : multiChoose)(
    ui(promptKey, promptValues),
    choices,
    initialValues,
    ...(allowBack ? [ui("backFromTargetSelection")] : []),
  );
  if (selected === BACK) return BACK;
  if (selected.includes(allRuntimeValue)) return [...targets].join(",");
  return [...targets].filter((target) => selected.includes(target)).join(",");
}

async function selectChannel(options, config, allowBack = false, forcePrompt = false) {
  if (options.channel) return options.channel;
  if (config?.channel && !forcePrompt) return config.channel;
  const choices = [
    { label: "stable", value: "stable" },
    { label: "beta", value: "beta" },
  ];
  const defaultChannel = releaseChannelForVersion(installedAkVersion) || config?.channel || "stable";
  const defaultIndex = defaultChannel === "beta" ? 1 : 0;
  return chooseLocalized(allowBack, ui("channelPrompt"), choices, defaultIndex);
}

async function approve(options, message) {
  if (options.yes) return true;
  return confirm(message);
}

function warnBetaLifecycle(channel) {
  if (channel !== "beta") return;
  const version = installedAkVersion.replace(/^ak\s+/i, "");
  if (!version || version.includes("-")) return;
  warning(`${ui("betaKitStableBinaryWarning", { version })}\n${ui("betaKitLifecycleReason")}`);
}

async function prepareBetaBinary(commandOptions, { requiresPreview = false } = {}) {
  warnBetaLifecycle("beta");
  const check = parseSelfUpdateOutput((await runCapture(
    akBinary, selfUpdateJsonCheckArgs("beta"),
  )).stdout);
  if (classifySelfUpdate(check) !== "update") {
    return { proceed: true, updated: false };
  }
  warning(ui("binaryPreviewPrerequisite", {
    channel: "beta",
    version: check.latest_version,
  }));
  printSection(ui("binaryPrerequisitePlan"));
  printPlan(selfUpdateApplyArgs("beta"));
  if (commandOptions.dryRun) {
    if (requiresPreview) {
      process.stdout.write(`\n${ui("binaryPrerequisiteDryRun")}\n`);
      return { proceed: false, updated: false };
    }
    return { proceed: true, updated: false };
  }
  if (!(await approve(commandOptions, ui("applyBinaryPrerequisite")))) {
    process.stdout.write(`${ui("binaryPrerequisiteDeclined")}\n`);
    return { proceed: false, updated: false };
  }
  const applied = parseSelfUpdateOutput((await runCapture(
    akBinary, selfUpdateJsonApplyArgs("beta"),
  )).stdout);
  if (!applied.applied) throw new Error(ui("binaryNoChange"));
  installedAkVersion = (await runCapture(akBinary, ["--version"])).stdout.trim();
  const verifiedVersion = installedAkVersion.replace(/^ak\s+/i, "");
  if (verifiedVersion !== applied.latest_version && verifiedVersion !== `v${applied.latest_version}`) {
    throw new Error(`beta binary verification failed: expected ${applied.latest_version}, got ${verifiedVersion}`);
  }
  process.stdout.write(`${ui("binaryPrerequisiteComplete", {
    version: verifiedVersion,
  })}\n`);
  return { proceed: true, updated: true };
}

async function install(commandOptions, allowBack = false) {
  let scope;
  let route;
  while (true) {
    const scopeWasPrompted = needsScopePrompt(commandOptions);
    const routeCanGoBack = allowBack || scopeWasPrompted;
    scope = await selectScope("install", commandOptions, allowBack);
    if (scope === BACK) return BACK;
    const config = scope.project ? await readProjectConfig(scope.project) : null;
    route = await walkSelections([
      { key: "kit", select: () => selectKit(commandOptions, config, routeCanGoBack, allowBack) },
      {
        key: "target",
        select: (values) => selectTarget(
          commandOptions, config, helperRuntimeTargets({
            command: "install", global: scope.global,
          }), "targetPrompt", routeCanGoBack, allowBack,
          { kit: kitName(values.kit) },
        ),
      },
      { key: "channel", select: () => selectChannel(commandOptions, config, routeCanGoBack, allowBack) },
    ]);
    if (route !== BACK) break;
    if (!scopeWasPrompted) return BACK;
  }
  const selection = { ...scope, ...route };
  if (specHasProfileTarget(selection.target) && !selection.global) {
    throw new Error(ui("profileTargetsNeedGlobal"));
  }
  const profiles = specHasProfileTarget(selection.target) ? await loadPiProfilesQuiet() : [];
  const installSelections = splitTargetSpec(selection.target)
    .map((target) => materializeHelperTarget({ ...selection, target }, profiles));

  printSection(ui("installPlan"));
  for (const targetSelection of installSelections) {
    printPlan(installArgs(targetSelection), targetSelection.project, targetSelection.envOverrides);
  }
  if (commandOptions.dryRun) {
    for (const targetSelection of installSelections) {
      await assertOmpNativeDestinations(targetSelection);
    }
    process.stdout.write(`\n${ui("dryRunFiles")}\n`);
    return;
  }
  if (selection.channel === "beta") {
    const betaBinary = await prepareBetaBinary(commandOptions);
    if (!betaBinary.proceed) return;
  }
  if (!(await approve(commandOptions, ui("runAk")))) {
    process.stdout.write(`${ui("cancelledFiles")}\n`);
    return;
  }

  for (const targetSelection of installSelections) {
    await assertOmpNativeDestinations(targetSelection);
    const cwd = targetSelection.project || process.cwd();
    const runOptions = {
      cwd,
      envOverrides: targetSelection.envOverrides,
      envUnset: targetSelection.envUnset,
    };
    try {
      await runAkCommand(installArgs(targetSelection), runOptions);
    } catch (error) {
      if (!requiresForceConsent(error)) throw error;
      warning(ui(targetSelection.global ? "globalForceWarning" : "projectForceWarning", {
        target: targetSelection.helperTarget || targetSelection.target,
      }));
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        error.message = `${error.message}\n${ui("forceNeedsConsent")}`;
        throw error;
      }
      if (!(await confirm(ui("confirmForceInstall"), false))) {
        process.stdout.write(`${ui("forceInstallDeclined")}\n`);
        return;
      }
      const forceArgs = installArgs(targetSelection, { force: true });
      printSection(ui("forceInstallPlan"));
      printPlan(forceArgs, targetSelection.project, targetSelection.envOverrides);
      await runAkCommand(forceArgs, runOptions);
    }
  }
  if (selection.project && !commandOptions.noSave) {
    const path = await writeProjectConfig(selection.project, selection);
    process.stdout.write(`${ui("savedChoice", { path })}\n`);
  }
  if (selection.project) {
    try {
      await run(akBinary, ["projects", "add", selection.project, "--yes"]);
    } catch (error) {
      process.stderr.write(`${ui("projectRegistrationFailed", { message: error.message })}\n`);
    }
  }
  process.stdout.write(`${ui("installComplete")}\n`);
}

async function selfUpdate(commandOptions, allowBack = false) {
  const channel = await selectChannel(commandOptions, null, allowBack);
  if (channel === BACK) return BACK;
  printSection(ui("binaryCheck"));
  const check = parseSelfUpdateOutput((await runCapture(
    akBinary, selfUpdateJsonCheckArgs(channel),
  )).stdout);
  process.stdout.write(`${ui("binaryVersions", {
    current: check.current_version,
    latest: check.latest_version,
    channel: check.channel || channel,
  })}\n`);
  const classification = classifySelfUpdate(check);
  if (classification === "current") {
    process.stdout.write(`${ui("binaryAlreadyCurrent")}\n`);
    return;
  }
  if (classification === "downgrade") {
    await downgradeBinary(commandOptions, check);
    return;
  }
  if (classification !== "update") {
    throw new Error(check.message || `ak self-update status: ${check.status}`);
  }

  const applyArgs = selfUpdateJsonApplyArgs(channel);
  printSection(ui("binaryPlan"));
  printPlan(selfUpdateApplyArgs(channel));
  if (commandOptions.dryRun) {
    process.stdout.write(`\n${ui("dryRunBinary")}\n`);
    return;
  }
  if (!(await approve(commandOptions, ui("applyBinary")))) {
    process.stdout.write(`${ui("cancelledBinary")}\n`);
    return;
  }
  const applied = parseSelfUpdateOutput((await runCapture(akBinary, applyArgs)).stdout);
  process.stdout.write(`${applied.applied ? ui("binaryComplete") : ui("binaryNoChange")}\n`);
}

function printDowngradePlan(channel, version, installDir) {
  if (process.platform === "win32") {
    process.stdout.write(`  $env:AK_CHANNEL='${channel}'; $env:AK_VERSION='${version}'; irm ${windowsInstallerUrl} | iex\n`);
    return;
  }
  process.stdout.write(`  curl -fsSL ${installerUrl} | ${formatCommand("env", [
    `AK_CHANNEL=${channel}`,
    `AK_VERSION=${version}`,
    `AK_INSTALL_DIR=${installDir}`,
    "sh",
  ])}\n`);
}

async function resolveAkInstallDir() {
  if (process.platform === "win32") return null;
  const located = akBinary.includes("/")
    ? resolve(akBinary)
    : (await runCapture("which", [akBinary])).stdout.split("\n")[0];
  return dirname(await realpath(located));
}

async function applyOfficialInstaller(channel, version, installDir) {
  if (process.platform === "win32") {
    const script = `$env:AK_CHANNEL='${channel}'; $env:AK_VERSION='${version}'; irm ${windowsInstallerUrl} | iex`;
    await run("powershell.exe", ["-NoProfile", "-Command", script]);
    return;
  }
  await runPipeline(
    process.env.AK_HELPER_CURL_BIN || "curl",
    ["-fsSL", installerUrl],
    process.env.AK_HELPER_SH_BIN || "sh",
    [],
    { targetEnv: { AK_CHANNEL: channel, AK_VERSION: version, AK_INSTALL_DIR: installDir } },
  );
}

async function downgradeBinary(commandOptions, check) {
  const version = assertInstallerVersion(check.latest_version);
  const channel = check.channel || commandOptions.channel;
  const installDir = await resolveAkInstallDir();
  process.stderr.write(`${ui("binaryDowngradeWarning", {
    channel,
    latest: version,
    current: check.current_version,
  })}\n`);
  process.stderr.write(`${ui("binaryDowngradeRisk")}\n`);
  printSection(ui("downgradePlan"));
  printDowngradePlan(channel, version, installDir);
  if (commandOptions.dryRun) {
    process.stdout.write(`\n${ui("dryRunBinary")}\n`);
    return;
  }

  let approved = false;
  if (process.stdin.isTTY && process.stdout.isTTY) {
    approved = commandOptions.allowDowngrade && commandOptions.yes
      ? true
      : await confirm(ui("confirmDowngrade", {
        current: check.current_version,
        latest: version,
      }), false);
  } else if (commandOptions.allowDowngrade && commandOptions.yes) {
    approved = true;
  } else {
    throw new Error(ui("downgradeNeedsConsent"));
  }
  if (!approved) {
    process.stdout.write(`${ui("cancelledDowngrade")}\n`);
    return;
  }

  await applyOfficialInstaller(channel, version, installDir);
  const verified = (await runCapture(akBinary, ["--version"])).stdout;
  const installedVersion = verified.trim().replace(/^ak\s+/, "");
  if (installedVersion !== version && installedVersion !== `v${version}`) {
    throw new Error(`downgrade verification failed: expected ${version}`);
  }
  process.stdout.write(`${ui("downgradeComplete", { version })}\n`);
}

async function update(commandOptions, allowBack = false) {
  let scope;
  let config;
  let channel;

  while (true) {
    const scopeWasPrompted = needsScopePrompt(commandOptions);
    const routeCanGoBack = allowBack || scopeWasPrompted;
    scope = await selectScope("update", commandOptions, allowBack);
    if (scope === BACK) return BACK;
    config = scope.project ? await readProjectConfig(scope.project) : null;

    if (
      scope.project &&
      !commandOptions.target &&
      !commandOptions.runtime &&
      config?.target &&
      !targetSpecIsSupported(config.target, UPDATE_TARGETS) &&
      (!process.stdin.isTTY || !process.stdout.isTTY)
    ) {
      throw new Error(ui("savedTargetNeedsUpdateRuntime", {
        target: config.target,
        supported: supportedList(UPDATE_TARGETS),
      }));
    }

    if (scope.binaryOnly) {
      channel = await selectChannel(commandOptions, config, routeCanGoBack, allowBack);
      if (channel !== BACK) break;
    } else {
      const route = await walkSelections([
        { key: "kit", select: () => selectKit(commandOptions, config, routeCanGoBack, allowBack) },
        { key: "channel", select: () => selectChannel(commandOptions, config, routeCanGoBack, allowBack) },
        {
          key: "target",
          select: async (values) => {
            const defaultTargets = helperRuntimeTargets({
              command: "update", global: scope.global,
            });
            let targets = defaultTargets;
            let installed = [];
            if (scope.global) {
              const installs = await discoverGlobalKitInstalls({
                akHome: process.env.AGENTKIT_HOME,
                supportedRuntimes: UPDATE_TARGETS,
                kits: [values.kit],
              });
              installed = installs[0]?.runtimes ?? [];
              targets = new Set([
                ...installed,
                ...[...defaultTargets].filter((target) => PROFILE_TARGETS.has(target)),
              ]);
              if (targets.size === 0) {
                throw new Error(ui("noGlobalKitInstalls", { kit: kitName(values.kit) }));
              }
            }
            const selected = await selectTarget(
              commandOptions, config, targets, "updateTargetPrompt", routeCanGoBack, allowBack,
              { kit: kitName(values.kit) },
            );
            if (selected === BACK) return BACK;
            if (scope.global) {
              const missing = splitTargetSpec(selected).filter((target) => !targets.has(target));
              if (missing.length > 0) {
                throw new Error(ui("globalTargetNotInstalled", {
                  kit: kitName(values.kit),
                  target: missing.join(", "),
                  installed: installed.length > 0 ? installed.join(", ") : ui("noneInstalled"),
                }));
              }
            }
            return selected;
          },
        },
      ]);
      if (route !== BACK) {
        channel = route.channel;
        scope = { ...scope, ...route };
        break;
      }
    }

    if (!scopeWasPrompted) return BACK;
  }

  if (scope.binaryOnly) {
    return selfUpdate({ ...commandOptions, channel });
  }

  const selection = {
    ...scope,
    channel,
  };
  if (specHasProfileTarget(selection.target) && !selection.global) {
    throw new Error(ui("profileTargetsNeedGlobal"));
  }
  const profiles = specHasProfileTarget(selection.target) ? await loadPiProfilesQuiet() : [];
  const updateSelections = splitTargetSpec(selection.target).map((target) => (
    materializeHelperTarget({ ...selection, target }, profiles)
  ));
  if (selection.global) warning(ui("globalUpdateSafety"));
  for (const targetSelection of updateSelections) {
    await assertOmpNativeDestinations(targetSelection);
  }
  if (channel === "beta") {
    const betaBinary = await prepareBetaBinary(commandOptions, { requiresPreview: true });
    if (!betaBinary.proceed) return;
  }

  printSection(ui("updatePreview"));
  for (const targetSelection of updateSelections) {
    if (updateSelections.length > 1) {
      process.stdout.write(`${colorText(targetSelection.helperTarget, "target")}\n`);
    }
    const previewArgs = updatePreviewArgsForRuntime(targetSelection);
    if (previewArgs) {
      await runAkCommand(previewArgs, {
        cwd: targetSelection.project || process.cwd(),
        envOverrides: targetSelection.envOverrides,
        envUnset: targetSelection.envUnset,
      });
    }
  }
  printSection(ui("applyPlan"));
  for (const targetSelection of updateSelections) {
    printPlan(
      updateApplyArgsForRuntime(targetSelection),
      targetSelection.project,
      targetSelection.envOverrides,
    );
  }
  if (commandOptions.dryRun) {
    process.stdout.write(`\n${ui("dryRunFiles")}\n`);
    return;
  }
  if (!(await approve(commandOptions, ui("applyKit")))) {
    process.stdout.write(`${ui("cancelledUpdate")}\n`);
    return;
  }

  for (const targetSelection of updateSelections) {
    await runAkCommand(updateApplyArgsForRuntime(targetSelection), {
      cwd: targetSelection.project || process.cwd(),
      envOverrides: targetSelection.envOverrides,
      envUnset: targetSelection.envUnset,
    });
  }
  if (selection.project && !commandOptions.noSave) {
    await writeProjectConfig(selection.project, selection);
  }
  process.stdout.write(`${ui("updateComplete")}\n`);
}

function updateAllCommandPlans(candidate, channel) {
  const kit = candidate.kit;
  if (candidate.kind === "project") {
    if (usesKitRefresh(candidate.runtime)) {
      return [{ preview: null, apply: kitRefreshArgs({
        global: false, kit, channel, target: candidate.runtime,
      }) }];
    }
    return [{
      preview: projectUpdatePreviewArgs(candidate.path, candidate.runtime, channel, kit),
      apply: projectUpdateApplyArgs(candidate.path, candidate.runtime, channel, kit),
    }];
  }
  const { update, refresh } = splitRuntimesForUpdate(candidate.runtimes);
  const plans = [];
  if (update.length > 0) {
    plans.push({
      preview: globalUpdatePreviewArgs(channel, update, kit),
      apply: globalUpdateApplyArgs(channel, update, kit),
    });
  }
  for (const runtime of refresh) {
    plans.push({
      preview: null,
      apply: kitRefreshArgs({ global: true, kit, channel, target: runtime }),
    });
  }
  return plans;
}

async function askDeepScanRoots() {
  return [await askDirectory(ui("deepScanRootsPrompt"), { root: homedir() })];
}

function buildUpdateCandidates(
  discovery,
  globalInstalls,
  piProfiles = [],
  claimedProfileRuntimes = new Set(),
) {
  const projects = discovery.projects.flatMap((project) => project.installs.map(({ kit, runtime }) => ({
    ...project,
    id: `${project.id}:${kit}:${runtime}`,
    kit,
    runtime,
    label: ui("projectCandidate", {
      name: project.name,
      path: project.path,
      runtime,
      kit: kitName(kit),
    }),
  })));
  const profileCandidates = piProfiles.map((profile) => ({
    id: `profile:${profile.runtime}:${profile.id}`,
    kind: "profile",
    kit: "engineer",
    runtime: profile.runtime,
    runtimes: [profile.runtime],
    profile,
    ...piProfileProcessOptions(profile),
    label: ui("piProfileCandidate", {
      profile: profile.id,
      runtime: profile.runtime,
    }),
  }));
  const ordinaryGlobalInstalls = globalInstalls
    .map((install) => install.kit === "engineer"
      ? {
        ...install,
        runtimes: install.runtimes.filter((runtime) => !claimedProfileRuntimes.has(runtime)),
      }
      : install)
    .filter((install) => install.runtimes.length > 0);
  return {
    registered: projects.filter((project) => project.sources.includes("registry")),
    unregistered: projects.filter((project) => !project.sources.includes("registry")),
    other: [
      ...profileCandidates,
      ...ordinaryGlobalInstalls.map(({ kit, runtimes }) => ({
        id: `global:${kit}`,
        kind: "global",
        kit,
        runtimes,
        label: ui("globalCandidate", { kit: kitName(kit), runtimes: runtimes.join(", ") }),
      })),
    ],
  };
}

function printCandidateGroup(title, candidates) {
  process.stdout.write(`\n${colorText(title, "group")}\n`);
  for (const candidate of candidates) {
    process.stdout.write(`  - ${colorText(candidate.label, "target")}\n`);
  }
}

function printUpdateInventory(groups) {
  printSection(ui("inventory"));
  if (groups.registered.length > 0) {
    printCandidateGroup(ui("registeredProjects"), groups.registered);
  } else {
    process.stdout.write(`  ${ui("noProjectsInRegistry")}\n`);
  }
  if (groups.unregistered.length > 0) {
    printCandidateGroup(ui("unregisteredProjects"), groups.unregistered);
  }
  if (groups.other.length > 0) printCandidateGroup(ui("otherInstalls"), groups.other);
}

function orderUpdateCandidates(candidates) {
  const priority = { profile: 0, global: 1, project: 2 };
  return [...candidates].sort((left, right) => priority[left.kind] - priority[right.kind]);
}

async function loadPiProfilesQuiet() {
  try {
    const inventory = await runCapture(piProfileManager.binary, [
      ...piProfileManager.prefixArgs,
      "profiles", "list", "--json",
    ]);
    return parsePiProfileInventory(inventory.stdout);
  } catch {
    return [];
  }
}

async function loadProfileUpdateState(globalInstalls) {
  const warnings = [];
  const profileRuntimeInstalls = new Set(globalInstalls
    .filter((install) => install.kit === "engineer")
    .flatMap((install) => install.runtimes)
    .filter((runtime) => runtime === "pi" || runtime === "omp"));
  let updateableProfiles = [];
  const claimedProfileRuntimes = new Set();
  try {
    const inventory = await runCapture(piProfileManager.binary, [
      ...piProfileManager.prefixArgs,
      "profiles", "list", "--json",
    ]);
    const profiles = parsePiProfileInventory(inventory.stdout);
    for (const profile of profiles.filter((profile) => profile.agentkitEnabled)) {
      claimedProfileRuntimes.add(profile.runtime);
    }
    const classified = classifyPiProfiles(profiles);
    updateableProfiles = classified.updateable;
    for (const profile of classified.skipped) {
      warnings.push(ui("piProfileSkipped", {
        profile: profile.id,
        reason: !profile.agentkitEnabled
          ? ui("piProfileNoAgentKit")
          : ui("piProfileNotSafe"),
      }));
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      for (const runtime of profileRuntimeInstalls) claimedProfileRuntimes.add(runtime);
      warnings.push(ui("piProfileDiscoveryUnavailable", { message: error.message }));
    }
  }
  return { updateableProfiles, claimedProfileRuntimes, warnings };
}

async function loadUpdateInventory(commandOptions, deepScanRoots) {
  const registry = await withSpinner(
    ui("loadingRegistry"),
    ui("loadedRegistry"),
    () => runCapture(akBinary, ["projects", "list", "--json"]),
  );
  const discover = () => discoverProjectCandidates({
    registryOutput: registry.stdout,
    deepScanRoots,
    maxDepth: commandOptions.maxDepth,
    excludes: commandOptions.excludes,
    supportedRuntimes: UPDATE_TARGETS,
  });
  const discovery = deepScanRoots.length > 0
    ? await withSpinner(ui("deepScanning"), ui("deepScanComplete"), discover)
    : await discover();
  const globalInstalls = await discoverGlobalKitInstalls({
    akHome: process.env.AGENTKIT_HOME,
    supportedRuntimes: UPDATE_TARGETS,
    kits: KITS,
  });
  const profiles = await loadProfileUpdateState(globalInstalls);
  discovery.warnings.push(...profiles.warnings);
  return {
    discovery,
    groups: buildUpdateCandidates(
      discovery,
      globalInstalls,
      profiles.updateableProfiles,
      profiles.claimedProfileRuntimes,
    ),
  };
}

async function loadSyncInventory() {
  const home = await resolveCanonicalHome();
  let cwd = process.cwd();
  try {
    cwd = await realpath(cwd);
  } catch {
    cwd = resolve(cwd);
  }
  const project = await discoverSyncProject({
    cwd,
    home,
    supportedRuntimes: UPDATE_TARGETS,
    kits: [...KITS],
  });
  const globalInstalls = await discoverGlobalKitInstalls({
    akHome: process.env.AGENTKIT_HOME,
    supportedRuntimes: UPDATE_TARGETS,
    kits: KITS,
  });
  const profiles = await loadProfileUpdateState(globalInstalls);
  const discovery = {
    projects: project ? [project] : [],
    warnings: profiles.warnings,
  };
  return {
    project,
    homeOrRoot: isHomeOrRootSyncCwd(cwd, home),
    groups: buildUpdateCandidates(
      discovery,
      globalInstalls,
      profiles.updateableProfiles,
      profiles.claimedProfileRuntimes,
    ),
    warnings: profiles.warnings,
  };
}

async function updateAll(commandOptions, allowBack = false) {
  while (true) {
    const channel = await selectChannel(commandOptions, null, allowBack, allowBack);
    if (channel === BACK) return BACK;
    let deepScanRoots = [...commandOptions.deepScanRoots];
    let selected;
    let scanBaselinePaths = null;
    while (!selected) {
      const { discovery, groups } = await loadUpdateInventory(commandOptions, deepScanRoots);
      for (const warning of discovery.warnings) {
        process.stderr.write(`${ui("discoveryWarning", { message: warning })}\n`);
      }
      printUpdateInventory(groups);
      const candidates = [...groups.registered, ...groups.unregistered, ...groups.other];
      const projectCandidates = [...groups.registered, ...groups.unregistered];
      const projectCount = new Set(projectCandidates.map((candidate) => candidate.path)).size;
      if (scanBaselinePaths) {
        const addedPaths = new Set(projectCandidates
          .map((candidate) => candidate.path)
          .filter((path) => !scanBaselinePaths.has(path)));
        process.stdout.write(`${ui("deepScanResult", { count: addedPaths.size })}\n`);
        scanBaselinePaths = null;
      }

      if (!process.stdin.isTTY || !process.stdout.isTTY || commandOptions.yes) {
        selected = candidates;
        break;
      }
      let reloadInventory = false;
      while (!selected && !reloadInventory) {
        const actionChoices = [
          { label: ui("updateEverything", { count: candidates.length }), value: "all" },
          {
            label: ui("updateAllProjects", { count: projectCount }),
            value: "projects",
            disabled: projectCandidates.length === 0 ? ui("noUpdateCandidates") : false,
          },
          { label: ui("chooseUpdates"), value: "choose" },
          { label: ui("customDeepScanAction"), value: "custom-deep-scan" },
        ];
        const action = allowBack
          ? await chooseWithBack(ui("selectUpdateAll"), actionChoices, 0, ui("escapeBack"))
          : await choose(ui("selectUpdateAll"), actionChoices);
        if (action === BACK) break;
        if (action === "custom-deep-scan") {
          scanBaselinePaths = new Set(projectCandidates.map((candidate) => candidate.path));
          deepScanRoots = [...new Set([...deepScanRoots, ...await askDeepScanRoots()])];
          reloadInventory = true;
          continue;
        }
        if (action === "all") {
          selected = candidates;
          continue;
        }
        if (action === "projects") {
          selected = projectCandidates;
          continue;
        }
        const ids = await multiChooseWithBack(
          ui("selectUpdateAll"),
          candidates.map((candidate) => ({ label: candidate.label, value: candidate.id })),
          candidates.map((candidate) => candidate.id),
          ui("backFromTargetSelection"),
        );
        if (ids === BACK) continue;
        const selectedAction = await chooseWithBack(
          ui("confirmSelectedUpdates", { count: ids.length }),
          [{ label: ui("previewSelectedUpdates", { count: ids.length }), value: "continue" }],
          0,
          ui("escapeBack"),
        );
        if (selectedAction === BACK) continue;
        selected = candidates.filter((candidate) => ids.includes(candidate.id));
      }
      if (reloadInventory) continue;
      if (!selected) break;
    }
    if (!selected) continue;
    if (selected.length === 0) throw new Error(ui("noUpdateCandidates"));
    selected = orderUpdateCandidates(selected);
    if (selected.some((candidate) => candidate.kind === "global" || candidate.kind === "profile")) {
      warning(ui("globalUpdateSafety"));
    }
    if (channel === "beta" && selected.length > 0) {
      const betaBinary = await prepareBetaBinary(commandOptions, { requiresPreview: true });
      if (!betaBinary.proceed) return;
    }

    printSection(ui("updateAllPreview"));
    for (const candidate of selected) {
      await assertOmpNativeDestinations(candidate);
      process.stdout.write(`\n${colorText(candidate.label, "target")}\n`);
      for (const plan of updateAllCommandPlans(candidate, channel)) {
        if (plan.preview) await runAkCommand(plan.preview, candidate);
      }
    }
    printSection(ui("updateAllApplyPlan"));
    for (const candidate of selected) {
      for (const plan of updateAllCommandPlans(candidate, channel)) {
        printPlan(plan.apply, null, candidate.envOverrides);
      }
    }
    if (commandOptions.dryRun) {
      process.stdout.write(`\n${ui("dryRunFiles")}\n`);
      return;
    }
    if (!(await approve(commandOptions, ui("applyAll")))) {
      process.stdout.write(`${ui("cancelledAll")}\n`);
      return;
    }
    for (const [index, candidate] of selected.entries()) {
      process.stdout.write(`${ui("updateProgress", {
        current: index + 1,
        total: selected.length,
        label: candidate.label,
      })}\n`);
      for (const plan of updateAllCommandPlans(candidate, channel)) {
        await runAkCommand(plan.apply, candidate);
      }
    }
    process.stdout.write(`${ui("updateAllComplete")}\n`);
    return;
  }
}

function printSyncInventory(channel, binary, inventory) {
  printSection(ui("syncInventory"));
  process.stdout.write(`  ${ui("syncChannel", { channel })}\n`);
  if (binary.classification === "update") {
    process.stdout.write(`  ${colorText(ui("syncBinaryUpdate", {
      current: binary.check.current_version,
      latest: binary.check.latest_version,
      channel: binary.check.channel || channel,
    }), "binary")}\n`);
  } else if (binary.classification === "current") {
    process.stdout.write(`  ${colorText(ui("syncBinaryCurrent", {
      version: binary.check.current_version,
      channel: binary.check.channel || channel,
    }), "binary")}\n`);
  } else {
    process.stdout.write(`  ${ui("syncBinarySkip", { status: binary.check.status })}\n`);
  }
  if (inventory.groups.other.length > 0) {
    printCandidateGroup(ui("otherInstalls"), inventory.groups.other);
  }
  const projectCandidates = [
    ...inventory.groups.registered,
    ...inventory.groups.unregistered,
  ];
  if (projectCandidates.length > 0) {
    printCandidateGroup(ui("syncProjectScope"), projectCandidates);
  } else if (inventory.homeOrRoot) {
    process.stdout.write(`  ${ui("syncHomeScope")}\n`);
  } else {
    process.stdout.write(`  ${ui("syncNoProject")}\n`);
  }
}

async function readBinarySyncState(channel) {
  const check = parseSelfUpdateOutput((await runCapture(
    akBinary, selfUpdateJsonCheckArgs(channel),
  )).stdout);
  return { check, classification: classifySelfUpdate(check) };
}

async function applySyncBinary(channel) {
  const applied = parseSelfUpdateOutput((await runCapture(
    akBinary, selfUpdateJsonApplyArgs(channel),
  )).stdout);
  if (!applied.applied) throw new Error(ui("binaryNoChange"));
  installedAkVersion = (await runCapture(akBinary, ["--version"])).stdout.trim();
  const verifiedVersion = installedAkVersion.replace(/^ak\s+/i, "");
  if (verifiedVersion !== applied.latest_version && verifiedVersion !== `v${applied.latest_version}`) {
    throw new Error(`binary verification failed: expected ${applied.latest_version}, got ${verifiedVersion}`);
  }
  process.stdout.write(`${ui("binaryComplete")}\n`);
}

async function sync(commandOptions, interactive = false) {
  const channel = syncChannelFromBinary(installedAkVersion);
  const inventory = await loadSyncInventory();
  for (const warning of inventory.warnings) {
    process.stderr.write(`${ui("discoveryWarning", { message: warning })}\n`);
  }
  const binary = await readBinarySyncState(channel);
  printSyncInventory(channel, binary, inventory);
  const selected = orderUpdateCandidates([
    ...inventory.groups.registered,
    ...inventory.groups.unregistered,
    ...inventory.groups.other,
  ]);
  const binaryNeedsUpdate = binary.classification === "update";
  if (!binaryNeedsUpdate && selected.length === 0) {
    process.stdout.write(`${ui("syncNothing")}\n`);
    return;
  }

  printSection(ui("syncApplyPlan"));
  if (binaryNeedsUpdate) printPlan(selfUpdateApplyArgs(channel));
  for (const candidate of selected) {
    for (const plan of updateAllCommandPlans(candidate, channel)) {
      printPlan(plan.apply, null, candidate.envOverrides);
    }
  }

  if (interactive && !(await approve(commandOptions, ui("confirmSync")))) {
    process.stdout.write(`${ui("cancelledSync")}\n`);
    return;
  }

  if (commandOptions.dryRun) {
    if (binaryNeedsUpdate) {
      process.stdout.write(`\n${ui("syncBinaryDryRunBlock")}\n`);
      return;
    }
    for (const candidate of selected) {
      await assertOmpNativeDestinations(candidate);
      process.stdout.write(`\n${colorText(candidate.label, "target")}\n`);
      for (const plan of updateAllCommandPlans(candidate, channel)) {
        if (plan.preview) await runAkCommand(plan.preview, candidate);
      }
    }
    process.stdout.write(`\n${ui("dryRunFiles")}\n`);
    return;
  }

  if (binaryNeedsUpdate) {
    if (channel === "beta") warnBetaLifecycle(channel);
    await applySyncBinary(channel);
  }
  if (selected.some((candidate) => candidate.kind === "global" || candidate.kind === "profile")) {
    warning(ui("globalUpdateSafety"));
  }
  for (const [index, candidate] of selected.entries()) {
    await assertOmpNativeDestinations(candidate);
    process.stdout.write(`${ui("updateProgress", {
      current: index + 1,
      total: selected.length,
      label: candidate.label,
    })}\n`);
    for (const plan of updateAllCommandPlans(candidate, channel)) {
      await runAkCommand(plan.apply, candidate);
    }
  }
  process.stdout.write(`${ui("syncComplete")}\n`);
}

async function exportKit(commandOptions, allowBack = false) {
  const choices = [
    { label: ui("agyExport"), value: "agy" },
    { label: ui("portableExport"), value: "portable" },
  ].filter((choice) => EXPORT_TARGETS.has(choice.value));
  const route = await walkSelections([
    {
      key: "kit",
      select: () => selectKit(commandOptions, null, allowBack),
    },
    {
      key: "target",
      select: () => commandOptions.target || chooseLocalized(
        allowBack,
        ui("exportTargetPrompt"),
        choices,
      ),
    },
    {
      key: "channel",
      select: () => selectChannel(commandOptions, null, allowBack),
    },
  ]);
  if (route === BACK) return BACK;
  const { kit, target, channel } = route;
  if (target === "agy" && commandOptions.target && !commandOptions.global) {
    throw new Error("agy export requires --global");
  }
  if (target === "agy" && commandOptions.out) {
    throw new Error("agy export uses --global, not --out");
  }
  if (target === "portable" && commandOptions.global) {
    throw new Error("portable export uses --out, not --global");
  }
  let out = null;
  if (target === "portable") {
    out = resolve(commandOptions.out || await ask(ui("exportDirectory")));
    if (isUnsafeProjectPath(out)) {
      throw new Error("portable export output cannot be the filesystem root or home directory");
    }
  }
  const selection = { kit, target, channel, global: target === "agy", out };
  const args = exportArgs(selection);
  printSection(ui("exportPlan"));
  printPlan(args);
  if (commandOptions.dryRun) {
    process.stdout.write(`\n${ui("dryRunFiles")}\n`);
    return;
  }
  if (channel === "beta") {
    const betaBinary = await prepareBetaBinary(commandOptions);
    if (!betaBinary.proceed) return;
  }
  if (!(await approve(commandOptions, ui("runExport")))) {
    process.stdout.write(`${ui("cancelledFiles")}\n`);
    return;
  }
  await runAkCommand(args);
  process.stdout.write(`${ui("exportComplete")}\n`);
}

async function doctor(options) {
  const cwd = options.project ? await resolveProjectPath(options.project) : process.cwd();
  await runAkCommand(["doctor", "--exit-on-fail", "--verbose"], { cwd });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.version) {
    process.stdout.write(`${metadata.version}\n`);
    return;
  }
  if (options.help || options.command === "help") {
    usage(options.language || "en");
    return;
  }
  if (!options.command && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error("interactive input is unavailable; pass explicit flags and --yes");
  }

  activeLanguage = await selectLanguage(options);
  setPromptCopy({ cancelled: ui("promptCancelled") });

  const interactiveRoot = !options.command;
  const languageCanChange = interactiveRoot && !options.language;
  installedAkVersion = await ensureAk(akBinary);
  if (interactiveRoot) {
    showCurrentBinary();
    await checkInteractiveBinaryUpdate();
  }
  while (true) {
    if (!options.command) {
      const command = await chooseCommand(languageCanChange);
      if (command === BACK) {
        activeLanguage = await selectLanguage(options, true);
        setPromptCopy({ cancelled: ui("promptCancelled") });
        showCurrentBinary();
        continue;
      }
      options.command = command;
    }
    activeAction = options.command;
    validateForCommand(options);
    let result;
    switch (options.command) {
      case "install":
        result = await install(options, interactiveRoot);
        break;
      case "update":
        result = await update(options, interactiveRoot);
        break;
      case "self-update":
        result = await selfUpdate(options, interactiveRoot);
        break;
      case "update-all":
        result = await updateAll(options, interactiveRoot);
        break;
      case "sync":
        result = await sync(options, interactiveRoot);
        break;
      case "export":
        result = await exportKit(options, interactiveRoot);
        break;
      case "doctor":
        result = await doctor(options);
        break;
      default:
        usage(activeLanguage);
        throw new Error(`unsupported command: ${options.command}`);
    }
    if (interactiveRoot && result === BACK) {
      options.command = null;
      continue;
    }
    break;
  }
  finishInteractive(ui("done"));
}

async function offerGitHubIssue(error) {
  if (!isReportableAkError(error, akBinary)) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const repository = resolveIssueRepository();
  const report = buildIssueReport({
    error,
    helperVersion: metadata.version,
    action: activeAction,
    language: activeLanguage,
    cwd: error.command?.cwd || process.cwd(),
  });
  try {
    try {
      await checkIssueRepository({ repository, ghBinary });
    } catch {
      warning(ui("issueRepoUnavailable", { repo: repository }));
      process.stderr.write(`${ui("issueRepoSetup")}\n`);
      return;
    }
    if (!(await confirm(ui("createIssue", { repo: repository }), false))) {
      process.stdout.write(`${ui("issueSkipped")}\n`);
      return;
    }
    const duplicate = await findDuplicateIssue(report, { repository, ghBinary });
    if (duplicate) {
      process.stdout.write(`${ui("issueDuplicate", { url: duplicate.url })}\n`);
      return;
    }
    const url = await createGitHubIssue(report, { repository, ghBinary });
    process.stdout.write(`${ui("issueCreated", { url })}\n`);
  } catch (issueError) {
    process.stderr.write(`${ui("issueFailed", { message: issueError.message })}\n`);
    process.stderr.write(`${ui("issueManual")}\n`);
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof PromptCancelledError) {
    process.exitCode = 0;
  } else {
    const exitCode = error.exitCode || 1;
    process.stderr.write(`${ui("error", { message: helperErrorMessage(error) })}\n`);
    try {
      await offerGitHubIssue(error);
    } catch (reportError) {
      if (!(reportError instanceof PromptCancelledError)) {
        process.stderr.write(`${ui("issueFailed", { message: reportError.message })}\n`);
      }
    }
    process.exitCode = exitCode;
  }
}
