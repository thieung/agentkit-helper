import { open, lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const SKIP_NAMES = new Set([
  "config",
  "known_hosts",
  "known_hosts.old",
  "authorized_keys",
  "authorized_keys2",
  "environment",
]);

const WELL_KNOWN = [
  "id_ed25519",
  "id_ed25519_sk",
  "id_ecdsa",
  "id_ecdsa_sk",
  "id_rsa",
  "id_dsa",
];

const WELL_KNOWN_RANK = new Map(WELL_KNOWN.map((name, index) => [name, index]));
const PRIVATE_KEY_HEADER = /^-----BEGIN .*PRIVATE KEY-----/;
const SNIFF_BYTES = 120;

export function resolveIdentityPath(input, { cwd = process.cwd(), home = homedir() } = {}) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return resolve(home, trimmed.slice(2));
  return resolve(cwd, trimmed);
}

async function firstLine(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.toString("utf8", 0, bytesRead).split(/\r?\n/, 1)[0] || "";
  } finally {
    await handle.close();
  }
}

export async function listSshIdentityFiles({ home = homedir() } = {}) {
  const sshDir = resolve(home, ".ssh");
  let names;
  try {
    names = await readdir(sshDir);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EACCES" || error.code === "EPERM") {
      return [];
    }
    throw error;
  }

  const found = [];
  for (const name of names) {
    if (SKIP_NAMES.has(name) || name.endsWith(".pub")) continue;
    const path = join(sshDir, name);
    let metadata;
    try {
      metadata = await lstat(path);
    } catch {
      continue;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) continue;

    const rank = WELL_KNOWN_RANK.has(name) ? WELL_KNOWN_RANK.get(name) : WELL_KNOWN.length;
    if (!WELL_KNOWN_RANK.has(name)) {
      let header = "";
      try {
        header = await firstLine(path);
      } catch {
        continue;
      }
      if (!PRIVATE_KEY_HEADER.test(header)) continue;
    }
    found.push({ path, name, rank });
  }

  found.sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name));
  return found.map((item) => item.path);
}

export function identityLabel(path) {
  return `${basename(path)} (${path})`;
}
