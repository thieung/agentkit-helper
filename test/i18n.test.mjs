import test from "node:test";
import assert from "node:assert/strict";
import { t } from "../lib/i18n.mjs";

test("localizes helper-owned UI without changing runtime identifiers", () => {
  assert.equal(t("vi", "installAction"), "Cài Kit");
  assert.equal(t("en", "installAction"), "Install a Kit");
  assert.equal(t("vi", "marketingKit"), "Marketing Kit");
  assert.match(t("vi", "targetPrompt", { kit: "Marketing Kit" }), /Marketing Kit/);
  assert.equal(t("vi", "allRuntimes"), "Tất cả runtime được hỗ trợ");
  assert.match(t("vi", "piAkProfile"), /pi-ak/);
  assert.match(t("vi", "profileTargetsNeedGlobal"), /--global/);
  assert.equal(t("en", "selfUpdateAction"), "Update ak binary");
  assert.equal(t("vi", "currentBinary", {
    version: "2.14.0", channel: "stable",
  }), "ak binary hiện tại: 2.14.0 (stable)");
  assert.match(t("vi", "binaryUpdateAvailable", {
    current: "2.14.0", latest: "2.14.1", channel: "stable",
  }), /2\.14\.0.*2\.14\.1/);
  assert.equal(t("vi", "binaryUpToDate", {
    version: "2.15.0-beta.4", channel: "beta",
  }), "ĐÃ LÀ BẢN MỚI NHẤT: ak 2.15.0-beta.4 trên channel beta.");
  assert.match(t("en", "updateAllAction"), /all detected AgentKit installs/);
  assert.match(t("vi", "updateAllAction"), /AgentKit install đã detect/);
  assert.match(t("en", "syncAction"), /Sync ak binary/);
  assert.match(t("vi", "syncAction"), /Sync ak binary/);
  assert.match(t("vi", "syncHomeScope"), /mọi runtime đã cài global/);
  assert.match(t("en", "confirmSync"), /Apply this sync plan/);
  assert.match(t("vi", "binaryDowngradeWarning", {
    channel: "stable", latest: "2.14.0", current: "2.15.0-beta.3",
  }), /không downgrade/);
  assert.match(t("en", "confirmDowngrade", {
    latest: "2.14.0", current: "2.15.0-beta.3",
  }), /older 2\.14\.0/);
  assert.equal(t("vi", "exportAction"), "Export Kit (không cài vào runtime)");
  assert.match(t("en", "exportTargetPrompt"), /does not install a runtime/);
  assert.match(t("vi", "exportTargetPrompt"), /không cài vào runtime/);
  assert.equal(t("vi", "doctorAction"), "Chạy health check");
  assert.equal(t("vi", "backToLanguage"), "← Quay lại chọn ngôn ngữ");
  assert.equal(t("vi", "escapeBack"), "Esc: Quay lại");
  assert.match(t("vi", "scopePrompt"), /scope nào/);
  assert.equal(t("vi", "customDeepScanAction"), "Chọn project thủ công…");
  assert.match(t("vi", "confirmSelectedUpdates", { count: 3 }), /3 target/);
  assert.match(t("vi", "deepScanRootsPrompt"), /gõ để lọc.*Enter/);
  assert.match(t("vi", "deepScanResult", { count: 0 }), /thêm 0 project/);
  assert.match(t("en", "updateEverything", { count: 4 }), /global \+ projects \(4\)/);
  assert.match(t("vi", "updateAllProjects", { count: 2 }), /Chỉ update.*\(2\)/);
  assert.equal(t("vi", "otherInstalls"), "Global scope:");
  assert.equal(t("vi", "backFromTargetSelection"), "Esc: Quay lại");
  assert.match(t("vi", "betaKitStableBinaryWarning", { version: "2.14.0" }), /sang beta/);
  assert.match(t("en", "agyExport"), /global-only export/);
  assert.match(t("vi", "portableExport"), /thư mục output/);
  assert.match(t("vi", "unsafeCwd", { cwd: "/tmp/project" }), /\/tmp\/project/);
  assert.match(t("en", "linkedNativeDestination", { path: "/tmp/project/AGENTS.md" }), /symlink/);
  assert.match(t("vi", "linkedNativeDestination", { path: "/tmp/project/AGENTS.md" }), /symlink/);
});
