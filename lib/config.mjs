import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
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
