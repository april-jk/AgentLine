#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const rootPackagePath = resolve(repoRoot, "package.json");
const checkOnly = process.argv.includes("--check");

function readText(path) {
  return readFileSync(path, "utf8");
}

function writeText(path, value) {
  writeFileSync(path, value);
}

function updateJson(relativePath, updater) {
  const path = resolve(repoRoot, relativePath);
  const before = readText(path);
  const data = JSON.parse(before);
  updater(data);
  const after = `${JSON.stringify(data, null, 2)}\n`;
  return { path, before, after };
}

function updateText(relativePath, updater) {
  const path = resolve(repoRoot, relativePath);
  const before = readText(path);
  const after = updater(before);
  return { path, before, after };
}

const rootPackage = JSON.parse(readText(rootPackagePath));
const version = rootPackage.version;
const mobileAppConfigPath = resolve(repoRoot, "packages/mobile-rn/app.json");
const mobileAppConfig = JSON.parse(readText(mobileAppConfigPath));
const mobileIosBundleId = mobileAppConfig.expo?.ios?.bundleIdentifier;
const mobileAndroidPackage = mobileAppConfig.expo?.android?.package;

if (!version) {
  throw new Error("Root package.json is missing a version field.");
}

if (!mobileIosBundleId || !mobileAndroidPackage) {
  throw new Error(
    "packages/mobile-rn/app.json must define both expo.ios.bundleIdentifier and expo.android.package.",
  );
}

const updates = [
  updateJson("packages/client/package.json", (data) => {
    data.version = version;
  }),
  updateJson("packages/server/package.json", (data) => {
    data.version = version;
  }),
  updateJson("packages/shared/package.json", (data) => {
    data.version = version;
  }),
  updateJson("packages/relay/package.json", (data) => {
    data.version = version;
  }),
  updateJson("packages/desktop-electron/package.json", (data) => {
    data.version = version;
  }),
  updateJson("packages/mobile-rn/package.json", (data) => {
    data.version = version;
  }),
  updateJson("packages/mobile-rn/app.json", (data) => {
    data.expo.version = version;
  }),
  updateJson("packages/desktop/package.json", (data) => {
    data.version = version;
  }),
  updateJson("packages/mobile/package.json", (data) => {
    data.version = version;
  }),
  updateText("packages/desktop/src-tauri/tauri.conf.json", (content) =>
    content.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`),
  ),
  updateText("packages/mobile/src-tauri/tauri.conf.json", (content) =>
    content.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`),
  ),
  updateText("packages/desktop/src-tauri/Cargo.toml", (content) =>
    content.replace(/^version = ".*"$/m, `version = "${version}"`),
  ),
  updateText("packages/mobile/src-tauri/Cargo.toml", (content) =>
    content.replace(/^version = ".*"$/m, `version = "${version}"`),
  ),
  updateText("packages/android-device-server/app/build.gradle.kts", (content) =>
    content.replace(/versionName = ".*"/, `versionName = "${version}"`),
  ),
  updateText("packages/mobile-rn/android/app/build.gradle", (content) =>
    content
      .replace(/namespace '.*'/, `namespace '${mobileAndroidPackage}'`)
      .replace(/applicationId '.*'/, `applicationId '${mobileAndroidPackage}'`)
      .replace(/versionName ".*"/, `versionName "${version}"`),
  ),
  updateText(
    "packages/mobile-rn/ios/AgentLine.xcodeproj/project.pbxproj",
    (content) =>
      content
        .replace(/MARKETING_VERSION = .*;/g, `MARKETING_VERSION = ${version};`)
        .replace(
          /PRODUCT_BUNDLE_IDENTIFIER = .*;/g,
          `PRODUCT_BUNDLE_IDENTIFIER = ${mobileIosBundleId};`,
        ),
  ),
  updateText("packages/server/src/device/DeviceBridgeService.ts", (content) =>
    content.replace(
      /const BRIDGE_VERSION_FALLBACK = ".*";/,
      `const BRIDGE_VERSION_FALLBACK = "${version}";`,
    ),
  ),
];

const drift = updates.filter((entry) => entry.before !== entry.after);

if (checkOnly) {
  if (drift.length > 0) {
    const changedPaths = drift
      .map((entry) => entry.path.replace(`${repoRoot}/`, ""))
      .join("\n");
    console.error(`Version drift detected for ${version}:\n${changedPaths}`);
    process.exit(1);
  }

  console.log(`All tracked release versions already match ${version}.`);
  process.exit(0);
}

for (const entry of drift) {
  writeText(entry.path, entry.after);
  console.log(
    `Updated ${entry.path.replace(`${repoRoot}/`, "")} -> ${version}`,
  );
}

if (drift.length === 0) {
  console.log(
    `No version updates needed; everything already matches ${version}.`,
  );
}
