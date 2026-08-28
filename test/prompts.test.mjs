import test from "node:test";
import assert from "node:assert/strict";
import { confirmPromptOptions } from "../lib/prompts.mjs";

test("confirmation prompts default to Yes", () => {
  assert.deepEqual(confirmPromptOptions("Run command?"), {
    message: "Run command?",
    initialValue: true,
  });
});

test("external issue consent can explicitly default to No", () => {
  assert.deepEqual(confirmPromptOptions("Create issue?", false), {
    message: "Create issue?",
    initialValue: false,
  });
});
