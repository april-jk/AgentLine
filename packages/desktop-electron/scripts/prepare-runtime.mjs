import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const bundleRoot = path.join(repoRoot, "dist", "npm-package");
const runtimeRoot = path.join(packageRoot, "runtime", "agentline");

function resolveCommand(command) {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

function run(command, args, cwd) {
  execFileSync(resolveCommand(command), args, {
    cwd,
    stdio: "inherit",
  });
}

function ensureCleanRuntime() {
  const runtimeBase = path.join(packageRoot, "runtime");
  if (existsSync(runtimeBase)) {
    rmSync(runtimeBase, { recursive: true, force: true });
  }
  mkdirSync(runtimeRoot, { recursive: true });
}

function buildServerBundle() {
  run("pnpm", ["build:bundle"], repoRoot);
}

function copyBundle() {
  if (!existsSync(bundleRoot)) {
    throw new Error(`Server bundle not found: ${bundleRoot}`);
  }
  cpSync(bundleRoot, runtimeRoot, { recursive: true });
}

function installRuntimeDependencies() {
  // Install production dependencies inside bundled runtime so packaged app
  // can launch the embedded server without requiring a global Node project.
  run(
    "npm",
    ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"],
    runtimeRoot,
  );
}

ensureCleanRuntime();
buildServerBundle();
copyBundle();
installRuntimeDependencies();

console.log(`[prepare-runtime] Runtime prepared at ${runtimeRoot}`);
