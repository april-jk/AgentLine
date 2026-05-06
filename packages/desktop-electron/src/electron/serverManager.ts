import { type ChildProcessByStdio, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";

export type ServerState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export interface ServerStatus {
  state: ServerState;
  pid: number | null;
  port: number;
  message?: string;
  startedAt?: number;
}

const SERVER_PORT = 3400;

type ManagedChildProcess = ChildProcessByStdio<null, Readable, Readable>;

interface ServerManagerOptions {
  repoRoot: string;
  runtimeRoot?: string;
  dataDir: string;
  packaged: boolean;
  port?: number;
}

export class ServerManager extends EventEmitter {
  private readonly repoRoot: string;
  private readonly runtimeRoot: string | null;
  private readonly dataDir: string;
  private readonly packaged: boolean;
  private readonly port: number;
  private child: ManagedChildProcess | null = null;
  private status: ServerStatus;

  constructor(options: ServerManagerOptions) {
    super();
    this.repoRoot = options.repoRoot;
    this.runtimeRoot = options.runtimeRoot ?? null;
    this.dataDir = options.dataDir;
    this.packaged = options.packaged;
    this.port = options.port ?? SERVER_PORT;
    this.status = {
      state: "stopped",
      pid: null,
      port: this.port,
    };
  }

  getStatus(): ServerStatus {
    return { ...this.status };
  }

  async start(): Promise<ServerStatus> {
    if (this.status.state === "running" || this.status.state === "starting") {
      return this.getStatus();
    }

    const serverEntry = this.packaged
      ? path.join(this.runtimeRoot ?? "", "dist/index.js")
      : path.join(this.repoRoot, "packages/server/dist/index.js");
    const workingDir = this.packaged
      ? (this.runtimeRoot ?? this.repoRoot)
      : this.repoRoot;

    try {
      await access(serverEntry);
    } catch {
      this.updateStatus({
        state: "error",
        pid: null,
        port: this.port,
        message: `Server entry not found: ${serverEntry}`,
      });
      return this.getStatus();
    }

    this.updateStatus({
      state: "starting",
      pid: null,
      port: this.port,
      message: "Starting server...",
    });

    const child: ManagedChildProcess = spawn(process.execPath, [serverEntry], {
      cwd: workingDir,
      env: {
        ...process.env,
        PORT: String(this.port),
        MAINTENANCE_PORT: String(this.port + 1),
        VITE_PORT: String(this.port + 2),
        AGENTLINE_DATA_DIR: this.dataDir,
        NODE_ENV: "production",
        ...(this.packaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.child = child;

    child.stdout.on("data", (chunk) => {
      process.stdout.write(`[desktop-electron][server] ${chunk}`);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[desktop-electron][server] ${chunk}`);
    });

    child.once("spawn", () => {
      this.updateStatus({
        state: "running",
        pid: child.pid ?? null,
        port: this.port,
        startedAt: Date.now(),
      });
    });

    child.once("error", (error) => {
      this.child = null;
      this.updateStatus({
        state: "error",
        pid: null,
        port: this.port,
        message: error.message,
      });
    });

    child.once("exit", (code, signal) => {
      this.child = null;
      const wasStopping = this.status.state === "stopping";
      const message = wasStopping
        ? "Server stopped"
        : `Server exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`;

      this.updateStatus({
        state: wasStopping ? "stopped" : "error",
        pid: null,
        port: this.port,
        message,
      });
    });

    return this.getStatus();
  }

  async stop(): Promise<ServerStatus> {
    if (!this.child || this.status.state === "stopped") {
      this.updateStatus({
        state: "stopped",
        pid: null,
        port: this.port,
        message: "Server is not running",
      });
      return this.getStatus();
    }

    const child = this.child;
    this.updateStatus({
      state: "stopping",
      pid: child.pid ?? null,
      port: this.port,
      message: "Stopping server...",
    });

    child.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.child) {
          this.child.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    return this.getStatus();
  }

  async restart(): Promise<ServerStatus> {
    await this.stop();
    return this.start();
  }

  private updateStatus(status: ServerStatus): void {
    this.status = status;
    this.emit("status", this.getStatus());
  }
}
