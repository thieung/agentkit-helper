const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function releaseChannelForVersion(output) {
  const version = String(output || "").trim().replace(/^ak\s+/i, "");
  const match = SEMVER.exec(version);
  if (!match) return null;
  return match[4] ? "beta" : "stable";
}

function comparePrerelease(left, right) {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    if (leftParts[index] === rightParts[index]) continue;
    const leftNumber = /^\d+$/.test(leftParts[index]) ? Number(leftParts[index]) : null;
    const rightNumber = /^\d+$/.test(rightParts[index]) ? Number(rightParts[index]) : null;
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

export function compareVersions(left, right) {
  const leftMatch = SEMVER.exec(left);
  const rightMatch = SEMVER.exec(right);
  if (!leftMatch || !rightMatch) throw new Error("invalid self-update version contract");
  for (let index = 1; index <= 3; index += 1) {
    const comparison = Number(leftMatch[index]) - Number(rightMatch[index]);
    if (comparison !== 0) return Math.sign(comparison);
  }
  return comparePrerelease(leftMatch[4] || "", rightMatch[4] || "");
}

export function parseSelfUpdateOutput(output) {
  const value = JSON.parse(output);
  const data = value?.data;
  if (
    value?.schema_version !== 1 || value?.kind !== "self_update" ||
    typeof data?.current_version !== "string" || typeof data?.latest_version !== "string" ||
    typeof data?.available !== "boolean" || typeof data?.status !== "string"
  ) {
    throw new Error("unsupported ak self-update JSON contract");
  }
  return data;
}

export function classifySelfUpdate(result) {
  if (result.available) return "update";
  if (result.status !== "current") return "unavailable";
  const comparison = compareVersions(result.latest_version, result.current_version);
  if (comparison < 0) return "downgrade";
  return comparison === 0 ? "current" : "unavailable";
}

export function assertInstallerVersion(version) {
  if (!SEMVER.test(version)) throw new Error("refusing invalid installer version");
  return version.replace(/^v/, "");
}
