import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve, win32 } from "node:path";
import { PROFILE_RUNTIME } from "./args.mjs";

function validPath(value) {
  return typeof value === "string" && (isAbsolute(value) || win32.isAbsolute(value));
}

export function piProfileManagerInvocation(
  configuredBinary = "pi-profile-manager",
  {
    platform = process.platform,
    home = homedir(),
    fileExists = existsSync,
    nodeBinary = process.execPath,
  } = {},
) {
  if (platform !== "win32") return { binary: configuredBinary, prefixArgs: [] };

  const extension = extname(configuredBinary).toLowerCase();
  if ([".js", ".cjs", ".mjs"].includes(extension)) {
    return { binary: nodeBinary, prefixArgs: [configuredBinary] };
  }

  const siblingModule = extension === ".cmd"
    ? configuredBinary.slice(0, -extension.length) + ".mjs"
    : null;
  const managedModule = (platform === "win32" ? win32.resolve : resolve)(
    home,
    "bin",
    "pi-profile-manager.mjs",
  );
  const modulePath = siblingModule && fileExists(siblingModule)
    ? siblingModule
    : (!configuredBinary.includes("/") && !configuredBinary.includes("\\") && fileExists(managedModule)
      ? managedModule
      : null);
  return modulePath
    ? { binary: nodeBinary, prefixArgs: [modulePath] }
    : { binary: configuredBinary, prefixArgs: [] };
}

export function parsePiProfileInventory(output) {
  const value = JSON.parse(output);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.profiles)) {
    throw new Error("unsupported pi-profile-manager profile inventory contract");
  }
  const ids = new Set();
  return value.profiles.map((profile) => {
    const sessionIsValid = profile?.runtime === "omp"
      ? profile.sessionDir === null
      : validPath(profile?.sessionDir);
    if (
      !profile || typeof profile.id !== "string" || !profile.id.trim() ||
      !["pi", "omp"].includes(profile.runtime) || !validPath(profile.agentDir) ||
      !sessionIsValid || typeof profile.agentkitEnabled !== "boolean" ||
      typeof profile.managed !== "boolean" || typeof profile.healthy !== "boolean"
    ) {
      throw new Error("invalid pi-profile-manager profile inventory entry");
    }
    if (ids.has(profile.id)) {
      throw new Error("duplicate pi-profile-manager profile inventory entry");
    }
    ids.add(profile.id);
    return {
      id: profile.id,
      runtime: profile.runtime,
      agentDir: profile.agentDir,
      sessionDir: profile.sessionDir,
      agentkitEnabled: profile.agentkitEnabled,
      managed: profile.managed,
      healthy: profile.healthy,
    };
  });
}

export function piProfileProcessOptions(profile) {
  if (profile.runtime === "omp") {
    return {
      envOverrides: { AGENTKIT_OMP_HOME: profile.agentDir },
      envUnset: ["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "OMP_HOME"],
    };
  }
  return {
    envOverrides: {
      PI_CODING_AGENT_DIR: profile.agentDir,
      PI_CODING_AGENT_SESSION_DIR: profile.sessionDir,
    },
    envUnset: ["AGENTKIT_OMP_HOME", "OMP_HOME"],
  };
}

export function classifyPiProfiles(profiles) {
  return {
    updateable: profiles.filter((profile) => (
      profile.agentkitEnabled && profile.managed && profile.healthy
    )),
    skipped: profiles.filter((profile) => !(
      profile.agentkitEnabled && profile.managed && profile.healthy
    )),
  };
}

export function isProfileTarget(target) {
  return Object.hasOwn(PROFILE_RUNTIME, target);
}

export function akRuntimeForHelperTarget(target) {
  return PROFILE_RUNTIME[target] || target;
}

export function defaultProfileProcessOptions(id, { home = homedir() } = {}) {
  if (id === "pi-ak") {
    const agentDir = join(home, ".pi", "profiles", "pi-ak");
    return piProfileProcessOptions({
      runtime: "pi", agentDir, sessionDir: join(agentDir, "sessions"),
    });
  }
  if (id === "pi-omp") {
    return piProfileProcessOptions({
      runtime: "omp",
      agentDir: join(home, ".omp", "profiles", "pi-omp", "agent"),
      sessionDir: null,
    });
  }
  return { envOverrides: {}, envUnset: [] };
}

export function resolveProfileProcessOptions(id, profiles = [], { home = homedir() } = {}) {
  const found = profiles.find((profile) => profile.id === id);
  return found ? piProfileProcessOptions(found) : defaultProfileProcessOptions(id, { home });
}

export function materializeHelperTarget(selection, profiles = [], { home = homedir() } = {}) {
  const helperTarget = selection.target;
  const env = isProfileTarget(helperTarget)
    ? resolveProfileProcessOptions(helperTarget, profiles, { home })
    : { envOverrides: {}, envUnset: [] };
  return {
    ...selection,
    helperTarget,
    target: akRuntimeForHelperTarget(helperTarget),
    ...env,
  };
}
