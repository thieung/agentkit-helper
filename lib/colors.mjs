import { stdout } from "node:process";

const tones = {
  binary: "1;32",
  command: "36",
  group: "1;34",
  prompt: "1;36",
  section: "1;36",
  target: "1;35",
  warning: "1;33",
};

export function supportsColor(stream = stdout) {
  return Boolean(stream.isTTY) && !("NO_COLOR" in process.env) && process.env.TERM !== "dumb";
}

export function colorText(message, tone, { stream = stdout, enabled = supportsColor(stream) } = {}) {
  const code = tones[tone];
  if (!enabled || !code) return message;
  return `\u001B[${code}m${message}\u001B[0m`;
}
