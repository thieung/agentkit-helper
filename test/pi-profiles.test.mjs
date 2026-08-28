import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPiProfiles,
  parsePiProfileInventory,
  piProfileManagerInvocation,
  piProfileProcessOptions,
} from "../lib/pi-profiles.mjs";

const profiles = parsePiProfileInventory(JSON.stringify({
  schemaVersion: 1,
  profiles: [
    {
      id: "pi-ak", runtime: "pi", agentDir: "/profiles/pi-ak",
      sessionDir: "/profiles/pi-ak/sessions", agentkitEnabled: true,
      managed: true, healthy: true,
    },
    {
      id: "pi-dev", runtime: "pi", agentDir: "/profiles/pi-dev",
      sessionDir: "/profiles/pi-dev/sessions", agentkitEnabled: false,
      managed: true, healthy: true,
    },
  ],
}));

test("parses and classifies safe AgentKit Pi profiles", () => {
  const classified = classifyPiProfiles(profiles);
  assert.deepEqual(classified.updateable.map(({ id }) => id), ["pi-ak"]);
  assert.deepEqual(classified.skipped.map(({ id }) => id), ["pi-dev"]);
});

test("builds isolated child-process environment for Pi profiles", () => {
  assert.deepEqual(piProfileProcessOptions(profiles[0]), {
    envOverrides: {
      PI_CODING_AGENT_DIR: "/profiles/pi-ak",
      PI_CODING_AGENT_SESSION_DIR: "/profiles/pi-ak/sessions",
    },
    envUnset: ["AGENTKIT_OMP_HOME", "OMP_HOME"],
  });
});

test("rejects malformed profile inventory", () => {
  assert.throws(
    () => parsePiProfileInventory('{"schemaVersion":1,"profiles":[{"id":"pi-ak"}]}'),
    /invalid pi-profile-manager profile inventory entry/,
  );
});

test("rejects duplicate profile identifiers", () => {
  const profile = {
    id: "pi-ak", runtime: "pi", agentDir: "/profiles/pi-ak",
    sessionDir: "/profiles/pi-ak/sessions", agentkitEnabled: true,
    managed: true, healthy: true,
  };
  assert.throws(
    () => parsePiProfileInventory(JSON.stringify({
      schemaVersion: 1,
      profiles: [profile, profile],
    })),
    /duplicate pi-profile-manager profile inventory entry/,
  );
});

test("uses the managed Node payload instead of the Windows cmd launcher", () => {
  assert.deepEqual(piProfileManagerInvocation("pi-profile-manager", {
    platform: "win32",
    home: "C:\\Users\\Me",
    nodeBinary: "node.exe",
    fileExists: (path) => path === "C:\\Users\\Me\\bin\\pi-profile-manager.mjs",
  }), {
    binary: "node.exe",
    prefixArgs: ["C:\\Users\\Me\\bin\\pi-profile-manager.mjs"],
  });
});
