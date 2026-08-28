import { homedir } from "node:os";
import { parse, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";

export function isUnsafeProjectPath(path, home = homedir()) {
  const absolute = resolve(path);
  return absolute === parse(absolute).root || absolute === resolve(home);
}

export async function resolveProjectPath(input, cwd = process.cwd(), home = homedir()) {
  const project = resolve(input || cwd);
  if (isUnsafeProjectPath(project, home)) {
    throw new Error(
      `not using ${project} as project scope; choose --project <path>, --global, or update --binary-only`,
    );
  }

  let metadata;
  try {
    metadata = await stat(project);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`project directory does not exist: ${project}`);
    }
    throw error;
  }
  if (!metadata.isDirectory()) {
    throw new Error(`project path is not a directory: ${project}`);
  }
  const canonicalProject = await realpath(project);
  if (isUnsafeProjectPath(canonicalProject, home)) {
    throw new Error(
      `not using ${project} as project scope because it resolves to ${canonicalProject}`,
    );
  }
  return canonicalProject;
}
