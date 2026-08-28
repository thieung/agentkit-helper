import test from "node:test";
import assert from "node:assert/strict";
import { colorText } from "../lib/colors.mjs";

test("colors semantic terminal text when enabled", () => {
  assert.equal(colorText("ak 2.14.0 (stable)", "binary", { enabled: true }), "\u001B[1;32mak 2.14.0 (stable)\u001B[0m");
  assert.equal(colorText("Preview", "section", { enabled: true }), "\u001B[1;36mPreview\u001B[0m");
  assert.equal(colorText("project", "target", { enabled: true }), "\u001B[1;35mproject\u001B[0m");
  assert.equal(colorText("ak update", "command", { enabled: true }), "\u001B[36mak update\u001B[0m");
});

test("keeps plain text when color is disabled", () => {
  assert.equal(colorText("Preview", "section", { enabled: false }), "Preview");
});
