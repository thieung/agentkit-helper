import {
  cancel,
  confirm as clackConfirm,
  intro,
  isCancel,
  multiselect,
  outro,
  path as clackPath,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { stdin, stdout } from "node:process";
import { colorText } from "./colors.mjs";
import { BACK } from "./navigation.mjs";

let sessionStarted = false;
let promptCopy = {
  intro: "AgentKit Helper",
  cancelled: "Operation cancelled; no helper action was applied.",
};

export class PromptCancelledError extends Error {
  constructor() {
    super("interactive session cancelled");
    this.name = "PromptCancelledError";
  }
}

function requireTty() {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("interactive input is unavailable; pass explicit flags and --yes");
  }
}

function startSession() {
  requireTty();
  if (!sessionStarted) {
    intro(promptCopy.intro);
    sessionStarted = true;
  }
}

function unwrap(value) {
  if (!isCancel(value)) return value;
  cancel(promptCopy.cancelled);
  throw new PromptCancelledError();
}

function highlightPrompt(message) {
  return colorText(message, "prompt");
}

export async function choose(message, choices, defaultIndex = 0) {
  startSession();
  return unwrap(await select({
    message: highlightPrompt(message),
    options: choices,
    initialValue: choices[defaultIndex]?.value,
  }));
}

export async function chooseWithBack(message, choices, defaultIndex = 0, backLabel = "← Back") {
  return choose(message, [
    ...choices,
    { label: backLabel, value: BACK },
  ], defaultIndex);
}

export async function multiChoose(message, choices, initialValues = choices.map((choice) => choice.value)) {
  startSession();
  return unwrap(await multiselect({
    message: highlightPrompt(message),
    options: choices,
    initialValues,
    required: true,
  }));
}

export async function multiChooseWithBack(
  message,
  choices,
  initialValues = choices.map((choice) => choice.value),
  backLabel = "← Back (select with Space, then confirm with Enter)",
) {
  const values = await multiChoose(message, [
    ...choices,
    { label: backLabel, value: BACK },
  ], initialValues);
  return values.includes(BACK) ? BACK : values;
}

export async function ask(message) {
  startSession();
  const value = unwrap(await text({
    message: highlightPrompt(message),
    validate(input) {
      if (!input.trim()) return `${message} is required`;
    },
  }));
  return value.trim();
}

export async function askDirectory(message, { root = process.cwd() } = {}) {
  startSession();
  return unwrap(await clackPath({
    message: highlightPrompt(message),
    root,
    initialValue: root,
    directory: true,
  }));
}

export function confirmPromptOptions(message, initialValue = true) {
  return { message: highlightPrompt(message), initialValue };
}

export async function confirm(message, initialValue = true) {
  startSession();
  return unwrap(await clackConfirm(confirmPromptOptions(message, initialValue)));
}

export async function withSpinner(message, completeMessage, task) {
  if (!stdin.isTTY || !stdout.isTTY) return task();
  startSession();
  const progress = spinner();
  progress.start(highlightPrompt(message));
  try {
    const result = await task();
    progress.stop(highlightPrompt(completeMessage));
    return result;
  } catch (error) {
    progress.error(highlightPrompt(message));
    throw error;
  }
}

export function warning(message) {
  const output = colorText(message, "warning", { stream: process.stderr });
  process.stderr.write(`${output}\n`);
}

export function setPromptCopy(copy) {
  promptCopy = { ...promptCopy, ...copy };
}

export function finishInteractive(message) {
  if (sessionStarted) outro(message);
}
