import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

const VITE_PORT = 5173;
const VITE_URL = `http://127.0.0.1:${VITE_PORT}`;

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

const waitForPort = (port, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.on("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port}`));
          return;
        }
        setTimeout(check, 300);
      });
    };

    check();
  });

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

  const vite = run("pnpm", [
    "exec",
    "vite",
    "--host",
    "127.0.0.1",
    "--port",
    String(VITE_PORT),
  ]);

  try {
    await waitForPort(VITE_PORT);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    stopAll();
    process.exit(1);
    return;
  }

  const electron = run("pnpm", ["exec", "electron", "."], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: VITE_URL,
    },
  });

  electron.on("exit", (exitCode) => {
    if (!vite.killed) {
      vite.kill("SIGTERM");
    }
    process.exit(exitCode ?? 0);
  });
});
