import test from "node:test";
import assert from "node:assert/strict";
import { BACK, walkSelections } from "../lib/navigation.mjs";

test("Back revisits the immediately preceding selection", async () => {
  const answers = ["codex", BACK, "grok", "beta"];
  const visited = [];
  const result = await walkSelections([
    {
      key: "target",
      select: async () => {
        visited.push("target");
        return answers.shift();
      },
    },
    {
      key: "channel",
      select: async () => {
        visited.push("channel");
        return answers.shift();
      },
    },
  ]);

  assert.deepEqual(visited, ["target", "channel", "target", "channel"]);
  assert.deepEqual(result, { target: "grok", channel: "beta" });
});

test("Back from the first selection returns control to the parent menu", async () => {
  const result = await walkSelections([
    { key: "target", select: async () => BACK },
    { key: "channel", select: async () => "stable" },
  ]);

  assert.equal(result, BACK);
});
