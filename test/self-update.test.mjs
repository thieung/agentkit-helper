import test from "node:test";
import assert from "node:assert/strict";
import {
  assertInstallerVersion,
  classifySelfUpdate,
  compareVersions,
  parseSelfUpdateOutput,
  releaseChannelForVersion,
} from "../lib/self-update.mjs";

test("detects the default release channel from the installed ak version", () => {
  assert.equal(releaseChannelForVersion("ak 2.14.0"), "stable");
  assert.equal(releaseChannelForVersion("ak 2.15.0-beta.3"), "beta");
  assert.equal(releaseChannelForVersion("v2.15.0-rc.1"), "beta");
  assert.equal(releaseChannelForVersion("unknown"), null);
});

test("compares stable and prerelease SemVer correctly", () => {
  assert.equal(compareVersions("2.15.0-beta.3", "2.14.0"), 1);
  assert.equal(compareVersions("2.15.0-beta.3", "2.15.0"), -1);
  assert.equal(compareVersions("2.15.0-beta.10", "2.15.0-beta.3"), 1);
  assert.equal(compareVersions("v2.14.0", "2.14.0"), 0);
});

test("classifies an older selected channel as a downgrade", () => {
  const result = parseSelfUpdateOutput(JSON.stringify({
    schema_version: 1,
    kind: "self_update",
    data: {
      available: false,
      status: "current",
      current_version: "2.15.0-beta.3",
      latest_version: "2.14.0",
      channel: "stable",
    },
  }));
  assert.equal(classifySelfUpdate(result), "downgrade");
  assert.equal(classifySelfUpdate({ ...result, latest_version: "2.15.0-beta.3" }), "current");
  assert.equal(classifySelfUpdate({
    ...result, available: true, latest_version: "2.15.0",
  }), "update");
  assert.equal(classifySelfUpdate({ ...result, status: "unknown" }), "unavailable");
});

test("rejects invalid update contracts and installer versions", () => {
  assert.throws(() => parseSelfUpdateOutput("{}"), /unsupported/);
  assert.equal(assertInstallerVersion("v2.14.0"), "2.14.0");
  assert.throws(() => assertInstallerVersion("2.14.0; touch /tmp/no"), /refusing/);
});
