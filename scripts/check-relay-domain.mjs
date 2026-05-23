#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EXPECTED_CONTROL_PLANE_URL = "https://relay.oneceo.ai";
const EXPECTED_RELAY_WS_URL = "wss://relay.oneceo.ai/ws";
const EXPECTED_REMOTE_LOGIN_URL = "https://relay.oneceo.ai/remote/login";

const forbiddenPatterns = [
  "relay.agentline.com",
  "remote.agentline.com",
  "agentline.com/remote",
];

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split("\n")
  .filter(Boolean)
  .filter((file) => file !== "scripts/check-relay-domain.mjs")
  .filter((file) => !file.startsWith("packages/client/dist-remote/"));

const violations = [];

for (const file of trackedFiles) {
  const content = readFileSync(file, {
    encoding: "utf8",
  });
  for (const pattern of forbiddenPatterns) {
    if (content.includes(pattern)) {
      violations.push(`${file}: contains forbidden relay domain "${pattern}"`);
    }
  }
}

const relayDefaults = readFileSync("packages/shared/src/relay-defaults.ts", {
  encoding: "utf8",
});

const requiredDefaults = [
  EXPECTED_CONTROL_PLANE_URL,
  EXPECTED_RELAY_WS_URL,
  EXPECTED_REMOTE_LOGIN_URL,
];

for (const value of requiredDefaults) {
  if (!relayDefaults.includes(`"${value}"`)) {
    violations.push(`packages/shared/src/relay-defaults.ts: missing ${value}`);
  }
}

if (violations.length > 0) {
  console.error("Relay domain check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Relay domain check passed.");
