import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const files = readdirSync("test")
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => `test/${name}`);

const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...files],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
