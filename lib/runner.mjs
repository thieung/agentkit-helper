import { spawn } from "node:child_process";
import { extname } from "node:path";

export function spawnInvocation(binary, args, platform = process.platform) {
  if (platform === "win32" && [".js", ".cjs", ".mjs"].includes(extname(binary).toLowerCase())) {
    return { binary: process.execPath, args: [binary, ...args] };
  }
  return { binary, args };
}

function jsonErrorMessage(output) {
  const candidates = [output, ...String(output).split("\n").reverse()];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      const messages = [
        value?.error?.message,
        typeof value?.error === "string" ? value.error : null,
        value?.message,
        value?.data?.error?.message,
        typeof value?.data?.error === "string" ? value.data.error : null,
        value?.data?.message,
        value?.errors?.[0]?.message,
      ];
      const message = messages.find((item) => typeof item === "string" && item.trim());
      if (message) return message.trim();
    } catch {
      // A command may emit NDJSON mixed with ordinary diagnostic lines.
    }
  }
  return null;
}

function conciseErrorMessage(message) {
  const concise = String(message)
    .replace(/^Error:\s*/i, "")
    .replace(/^(?:init|install|update):\s*/i, "")
    .replace(/^lifecycle preflight:\s*/i, "")
    .trim();
  return concise.length > 160 ? `${concise.slice(0, 157)}…` : concise;
}

export function summarizeCommandFailure(stdout, stderr, fallback = "Command failed") {
  const jsonMessage = jsonErrorMessage(stderr.trim()) || jsonErrorMessage(stdout.trim());
  if (jsonMessage) return conciseErrorMessage(jsonMessage);
  const lines = `${stderr}\n${stdout}`
    .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[╭╰].*[╮╯]$/.test(line))
    .map((line) => line.replace(/^│\s?/, "").replace(/\s?│$/, "").trim())
    .filter((line) => line !== "Command failed.")
    .filter((line) => !/^→?\s*Re-run with --verbose/i.test(line));
  const explicitError = lines.find((line) => /^Error:/i.test(line));
  if (explicitError) return conciseErrorMessage(explicitError);
  return lines.slice(0, 4).map(conciseErrorMessage).join("\n") || fallback;
}

export function isLinkedNativeDestinationError(error) {
  const diagnostic = `${error?.message || ""}\n${error?.stderr || ""}\n${error?.stdout || ""}`;
  return /unsafe native destination/i.test(diagnostic) && /linked path component/i.test(diagnostic);
}

export function linkedNativeDestinationPath(error) {
  const diagnostic = `${error?.message || ""}\n${error?.stderr || ""}\n${error?.stdout || ""}`;
  return diagnostic.match(/unsafe native destination "([^"]+)"/i)?.[1] || null;
}

export function requiresForceConsent(error) {
  if (error?.exitCode === 6) return true;
  const diagnostic = `${error?.message || ""}\n${error?.stderr || ""}`;
  return /target directory already exists|drifted files detected/i.test(diagnostic) &&
    /--force/i.test(diagnostic);
}

function childEnv(envOverrides = {}, envUnset = []) {
  const env = { ...process.env, ...envOverrides };
  for (const name of envUnset) delete env[name];
  return env;
}

export function run(
  binary,
  args,
  { cwd = process.cwd(), stdio = "inherit", envOverrides = {}, envUnset = [] } = {},
) {
  return new Promise((resolve, reject) => {
    const invocation = spawnInvocation(binary, args);
    const child = spawn(invocation.binary, invocation.args, {
      cwd,
      stdio,
      shell: false,
      env: childEnv(envOverrides, envUnset),
    });
    child.once("error", (error) => {
      error.command = { binary, args: [...args], cwd };
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (signal) {
        const error = new Error(`${binary} terminated by ${signal}`);
        error.command = { binary, args: [...args], cwd };
        reject(error);
        return;
      }
      if (code !== 0) {
        const error = new Error(`${binary} exited with status ${code}`);
        error.exitCode = code;
        error.command = { binary, args: [...args], cwd };
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function runCapture(
  binary,
  args,
  { cwd = process.cwd(), envOverrides = {}, envUnset = [] } = {},
) {
  return new Promise((resolve, reject) => {
    const invocation = spawnInvocation(binary, args);
    const child = spawn(invocation.binary, invocation.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: childEnv(envOverrides, envUnset),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      error.command = { binary, args: [...args], cwd };
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        const fallback = signal
          ? `${binary} terminated by ${signal}`
          : `${binary} exited with status ${code}`;
        const error = new Error(summarizeCommandFailure(stdout, stderr, fallback));
        error.exitCode = code || 1;
        error.command = { binary, args: [...args], cwd };
        error.stdout = stdout.trim();
        error.stderr = stderr.trim();
        reject(error);
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export function runPipeline(
  sourceBinary,
  sourceArgs,
  targetBinary,
  targetArgs,
  { cwd = process.cwd(), targetEnv = {} } = {},
) {
  return new Promise((resolve, reject) => {
    const source = spawn(sourceBinary, sourceArgs, {
      cwd,
      stdio: ["ignore", "pipe", "inherit"],
      shell: false,
      env: process.env,
    });
    const target = spawn(targetBinary, targetArgs, {
      cwd,
      stdio: ["pipe", "inherit", "inherit"],
      shell: false,
      env: { ...process.env, ...targetEnv },
    });
    source.stdout.pipe(target.stdin);
    const command = {
      binary: sourceBinary,
      args: [...sourceArgs],
      cwd,
      pipeline: { binary: targetBinary, args: [...targetArgs] },
    };
    let sourceDone = false;
    let targetDone = false;
    let settled = false;

    function fail(message, exitCode = 1) {
      if (settled) return;
      settled = true;
      source.kill();
      target.kill();
      const error = new Error(message);
      error.exitCode = exitCode;
      error.command = command;
      reject(error);
    }

    function finish() {
      if (!settled && sourceDone && targetDone) {
        settled = true;
        resolve();
      }
    }

    source.once("error", (error) => fail(error.message));
    target.once("error", (error) => fail(error.message));
    source.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        fail(signal ? `${sourceBinary} terminated by ${signal}` : `${sourceBinary} exited with status ${code}`, code || 1);
        return;
      }
      sourceDone = true;
      finish();
    });
    target.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        fail(signal ? `${targetBinary} terminated by ${signal}` : `${targetBinary} exited with status ${code}`, code || 1);
        return;
      }
      targetDone = true;
      finish();
    });
  });
}

export async function ensureAk(binary) {
  try {
    return (await runCapture(binary, ["--version"])).stdout;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    const lines = [
      "The ak CLI is not available on PATH.",
      "Install it from the official AgentKit endpoint, then open a new terminal:",
      "",
    ];
    if (process.platform === "win32") {
      lines.push("  irm https://agentkit.best/install.ps1 | iex");
    } else {
      lines.push("  curl -fsSL https://agentkit.best/install.sh | sh");
    }
    throw new Error(lines.join("\n"));
  }
}
