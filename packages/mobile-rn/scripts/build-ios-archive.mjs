#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(resolve(packageDir, "package.json"), "utf8"),
);
const version = packageJson.version ?? "0.0.0";
const archivePath =
  process.env.AGENTLINE_IOS_ARCHIVE_PATH ??
  resolve(
    packageDir,
    "ios",
    "build",
    "archive",
    `AgentLineMobile-${version}.xcarchive`,
  );

function run(command, args, cwd = packageDir) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("pnpm", ["exec", "expo", "prebuild", "--platform", "ios", "--clean"]);
run("xcodebuild", [
  "-workspace",
  "ios/AgentLineMobile.xcworkspace",
  "-scheme",
  "AgentLineMobile",
  "-configuration",
  "Release",
  "-sdk",
  "iphoneos",
  "-archivePath",
  archivePath,
  "archive",
]);

console.log(`\niOS archive ready: ${archivePath}`);
