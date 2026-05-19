#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  readFileSync(resolve(packageDir, "package.json"), "utf8"),
);
const version = packageJson.version ?? "0.0.0";
const buildNumber = process.env.AGENTLINE_IOS_BUILD_NUMBER ?? "1";
const iosDir = resolve(packageDir, "ios");
const archivePath =
  process.env.AGENTLINE_IOS_ARCHIVE_PATH ??
  resolve(
    packageDir,
    "ios",
    "build",
    "archive",
    `AgentLine-${version}.xcarchive`,
  );

function detectWorkspacePath() {
  if (process.env.AGENTLINE_IOS_WORKSPACE?.trim()) {
    return process.env.AGENTLINE_IOS_WORKSPACE.trim();
  }

  const workspace = readdirSync(iosDir).find((entry) =>
    entry.endsWith(".xcworkspace"),
  );

  if (workspace) {
    return resolve(iosDir, workspace);
  }

  return resolve(iosDir, "AgentLine.xcworkspace");
}

function detectScheme() {
  if (process.env.AGENTLINE_IOS_SCHEME?.trim()) {
    return process.env.AGENTLINE_IOS_SCHEME.trim();
  }

  const sharedSchemesDir = resolve(
    packageDir,
    "ios",
    "AgentLine.xcodeproj",
    "xcshareddata",
    "xcschemes",
  );

  if (existsSync(sharedSchemesDir)) {
    const appScheme = readdirSync(sharedSchemesDir)
      .filter((entry) => entry.endsWith(".xcscheme"))
      .map((entry) => basename(entry, ".xcscheme"))
      .find((entry) => !entry.startsWith("Pods-"));

    if (appScheme) {
      return appScheme;
    }
  }

  return "AgentLine";
}

function detectDevelopmentTeam() {
  if (process.env.AGENTLINE_IOS_DEVELOPMENT_TEAM?.trim()) {
    return process.env.AGENTLINE_IOS_DEVELOPMENT_TEAM.trim();
  }

  const result = spawnSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    {
      encoding: "utf8",
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  const match = result.stdout.match(/\(([A-Z0-9]{10})\)/);
  return match?.[1] ?? null;
}

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
const workspacePath = detectWorkspacePath();
const scheme = detectScheme();
const developmentTeam = detectDevelopmentTeam();
const xcodebuildArgs = [
  "-workspace",
  workspacePath,
  "-scheme",
  scheme,
  "-configuration",
  "Release",
  "-sdk",
  "iphoneos",
  "-archivePath",
  archivePath,
  `MARKETING_VERSION=${version}`,
  `CURRENT_PROJECT_VERSION=${buildNumber}`,
  "archive",
];

if (developmentTeam) {
  console.log(`\nUsing iOS development team: ${developmentTeam}`);
  xcodebuildArgs.splice(
    xcodebuildArgs.length - 3,
    0,
    "-allowProvisioningUpdates",
    "CODE_SIGN_STYLE=Automatic",
    `DEVELOPMENT_TEAM=${developmentTeam}`,
  );
} else {
  console.warn(
    "\nNo iOS development team detected. Set AGENTLINE_IOS_DEVELOPMENT_TEAM to archive for TestFlight.",
  );
}

run("xcodebuild", xcodebuildArgs);

console.log(`\niOS archive ready: ${archivePath}`);
