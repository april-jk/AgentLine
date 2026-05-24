#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const AGENTLINE_DOMAIN = ["agentline", "com"].join(".");

const REQUIRED_RELAY_URLS = [
  "https://relay.oneceo.ai",
  "wss://relay.oneceo.ai/ws",
  "https://relay.oneceo.ai/remote/login",
  "https://relay.oneceo.ai/version",
  "https://relay.oneceo.ai/version/{{current_version}}",
  "https://relay.oneceo.ai/bridge/version",
  "https://relay.oneceo.ai/tauri/{{target}}/{{arch}}/{{current_version}}",
];

const REQUIRED_FILES_BY_URL = new Map([
  ["https://relay.oneceo.ai", ["packages/shared/src/relay-defaults.ts"]],
  ["wss://relay.oneceo.ai/ws", ["packages/shared/src/relay-defaults.ts"]],
  [
    "https://relay.oneceo.ai/remote/login",
    ["packages/shared/src/relay-defaults.ts"],
  ],
  [
    "https://relay.oneceo.ai/version",
    ["packages/server/src/routes/version.ts"],
  ],
  [
    "https://relay.oneceo.ai/version/{{current_version}}",
    [
      "packages/mobile-rn/src/lib/updateCheck.ts",
      "packages/desktop-electron/src/renderer/App.tsx",
    ],
  ],
  [
    "https://relay.oneceo.ai/bridge/version",
    ["packages/server/src/device/DeviceBridgeService.ts"],
  ],
  [
    "https://relay.oneceo.ai/tauri/{{target}}/{{arch}}/{{current_version}}",
    ["packages/desktop/src-tauri/tauri.conf.json"],
  ],
]);

const APPROVED_FIRST_PARTY_DOMAINS = new Set(["relay.oneceo.ai"]);

const forbiddenLiterals = [
  AGENTLINE_DOMAIN,
  `.${AGENTLINE_DOMAIN}`,
  `updates.${AGENTLINE_DOMAIN}`,
  `relay.${AGENTLINE_DOMAIN}`,
  `remote.${AGENTLINE_DOMAIN}`,
  `staging.${AGENTLINE_DOMAIN}`,
  `direct.${AGENTLINE_DOMAIN}`,
  `relay2.${AGENTLINE_DOMAIN}`,
  `${AGENTLINE_DOMAIN}/remote`,
  `${AGENTLINE_DOMAIN}/c/`,
];

const allowedThirdPartyFiles = new Set(["scripts/check-relay-domain.mjs"]);

const ignoredPathPrefixes = [
  "docs/research/",
  "docs/competitive/",
  "packages/client/dist-remote/",
  "site/dist/",
];

const ignoredBinaryExtensions = new Set([
  ".aab",
  ".apk",
  ".appimage",
  ".bin",
  ".dmg",
  ".exe",
  ".icns",
  ".ico",
  ".jpg",
  ".jpeg",
  ".keystore",
  ".otf",
  ".png",
  ".so",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split("\n")
  .filter(Boolean)
  .filter(
    (file) => !ignoredPathPrefixes.some((prefix) => file.startsWith(prefix)),
  )
  .filter((file) => !ignoredBinaryExtensions.has(extname(file).toLowerCase()));

const violations = [];
const firstPartyDomainPattern =
  /\b(?:[a-z0-9-]+\.)*(?:agentline\.com|oneceo\.ai)\b/gi;

function readTrackedFile(file) {
  return readFileSync(file, {
    encoding: "utf8",
  });
}

for (const file of trackedFiles) {
  const content = readTrackedFile(file);

  if (!allowedThirdPartyFiles.has(file)) {
    for (const literal of forbiddenLiterals) {
      if (content.includes(literal)) {
        violations.push(`${file}: contains forbidden domain text "${literal}"`);
      }
    }
  }

  for (const match of content.matchAll(firstPartyDomainPattern)) {
    const domain = match[0].toLowerCase();
    if (!APPROVED_FIRST_PARTY_DOMAINS.has(domain)) {
      violations.push(
        `${file}: contains unapproved first-party domain "${domain}"`,
      );
    }
  }
}

for (const url of REQUIRED_RELAY_URLS) {
  const expectedFiles = REQUIRED_FILES_BY_URL.get(url) ?? [];
  for (const file of expectedFiles) {
    const expectedText = url.replace("/{{current_version}}", "");
    if (!readTrackedFile(file).includes(expectedText)) {
      violations.push(`${file}: missing required relay URL "${url}"`);
    }
  }
}

for (const file of [
  "packages/mobile/src-tauri/tauri.conf.json",
  "packages/mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml",
]) {
  if (!readTrackedFile(file).includes("relay.oneceo.ai")) {
    violations.push(`${file}: mobile app link host must be relay.oneceo.ai`);
  }
}

if (violations.length > 0) {
  console.error("First-party domain check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("First-party domain check passed.");
