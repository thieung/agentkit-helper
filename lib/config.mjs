import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { CHANNELS, INSTALL_TARGETS, KITS, targetSpecIsSupported } from "./args.mjs";

export const CONFIG_NAME = ".ak-kit.json";

function validateConfig(value, path) {
  if (!value || typeof value !== "object") {
    throw new Error(`invalid helper config: ${path}`);
  }
  if (value.schemaVersion !== 1 || !KITS.has(value.kit) || value.scope !== "project") {
    throw new Error(`unsupported helper config contract: ${path}`);
  }
  if (!targetSpecIsSupported(value.target, INSTALL_TARGETS) || !CHANNELS.has(value.channel)) {
    throw new Error(`invalid target or channel in helper config: ${path}`);
  }
  return value;
}

export async function readProjectConfig(project) {
  const path = resolve(project, CONFIG_NAME);
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`refusing symlinked helper config: ${path}`);
    }
    return validateConfig(JSON.parse(await readFile(path, "utf8")), path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error(`invalid JSON in helper config: ${path}`);
    }
    throw error;
  }
}

export async function writeProjectConfig(project, selection) {
  const path = resolve(project, CONFIG_NAME);
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`refusing symlinked helper config: ${path}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const value = {
    schemaVersion: 1,
    kit: selection.kit || "engineer",
    target: selection.target,
    channel: selection.channel,
    scope: "project",
  };
  const temporaryPath = resolve(project, `${CONFIG_NAME}.tmp-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return path;
}

export const GLOBAL_CONFIG_DIR = ".agentkit-helper";
export const GLOBAL_CONFIG_FILE = "config.json";
export const MAX_RECENT_VPS_HOSTS = 10;

export function resolveGlobalConfigPath(home = process.env.AK_HELPER_HOME || homedir()) {
  return resolve(home, GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_FILE);
}

function defaultGlobalConfig() {
  return {
    schemaVersion: 1,
    vps: {
      defaultHost: null,
      recentHosts: [],
    },
  };
}

function validateGlobalConfig(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid global helper config: ${path}`);
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`unsupported global helper config contract: ${path}`);
  }
  const vps = value.vps && typeof value.vps === "object" && !Array.isArray(value.vps)
    ? value.vps
    : {};
  return {
    schemaVersion: 1,
    vps: {
      defaultHost: typeof vps.defaultHost === "string" && vps.defaultHost.trim()
        ? vps.defaultHost.trim()
        : null,
      recentHosts: Array.isArray(vps.recentHosts)
        ? vps.recentHosts.filter((item) => typeof item === "string" && item.trim()).map((s) => s.trim())
        : [],
    },
  };
}

export async function readGlobalHelperConfig({ home } = {}) {
  const path = resolveGlobalConfigPath(home);
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`refusing symlinked global helper config: ${path}`);
    }
    return validateGlobalConfig(JSON.parse(await readFile(path, "utf8")), path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return defaultGlobalConfig();
    }
    if (error instanceof SyntaxError) {
      throw new Error(`invalid JSON in global helper config: ${path}`);
    }
    throw error;
  }
}

export async function writeGlobalHelperConfig(config, { home } = {}) {
  const path = resolveGlobalConfigPath(home);
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`refusing symlinked global helper config: ${path}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const validated = validateGlobalConfig(config, path);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = resolve(dirname(path), `${GLOBAL_CONFIG_FILE}.tmp-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return path;
}

export async function addRecentVpsHost(host, { home, makeDefault = true } = {}) {
  const normalized = String(host || "").trim();
  if (!normalized) return readGlobalHelperConfig({ home });
  const current = await readGlobalHelperConfig({ home });
  const deduplicated = [
    normalized,
    ...current.vps.recentHosts.filter((item) => item !== normalized),
  ].slice(0, MAX_RECENT_VPS_HOSTS);
  const updated = {
    schemaVersion: 1,
    vps: {
      defaultHost: makeDefault ? normalized : current.vps.defaultHost,
      recentHosts: deduplicated,
    },
  };
  await writeGlobalHelperConfig(updated, { home });
  return updated;
}
