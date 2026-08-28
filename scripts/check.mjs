import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const files = [
  "bin/agentkit-helper.mjs",
  ...readdirSync("lib")
    .filter((name) => name.endsWith(".mjs"))
    .sort()
    .map((name) => `lib/${name}`),
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
