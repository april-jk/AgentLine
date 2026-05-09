import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

const children = [];

const run = (command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  children.push(child);
  return child;
};

const stopAll = () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}

const buildElectron = run("pnpm", [
  "exec",
  "tsc",
  "-p",
  "tsconfig.electron.json",
]);

buildElectron.on("exit", async (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
    return;
  }
  const electron = run("pnpm", ["exec", "electron", "."], {
    env: { ...process.env },
  });

  electron.on("exit", (exitCode) => {
    process.exit(exitCode ?? 0);
  });
});
