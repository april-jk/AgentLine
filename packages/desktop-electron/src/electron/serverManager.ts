import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
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
const OUTPUT_TAIL_LIMIT = 16_384;

type ManagedChildProcess = ChildProcessByStdio<null, Readable, Readable>;

interface ServerManagerOptions {
  repoRoot: string;
  runtimeRoot?: string;
  dataDir: string;
  packaged: boolean;
  port?: number;
  controlPlane?: ControlPlaneConfig;
}

export interface ControlPlaneConfig {
  baseUrl?: string;
  accessToken?: string;
  relayWsUrl?: string;
  deviceName?: string;
  deviceType?: string;
  heartbeatIntervalMs?: number;
}

interface LaunchConfig {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export class ServerManager extends EventEmitter {
  private readonly repoRoot: string;
  private readonly runtimeRoot: string | null;
  private readonly dataDir: string;
  private readonly packaged: boolean;
  private readonly port: number;
  private controlPlane: ControlPlaneConfig;
  private readonly desktopAuthToken: string;
  private child: ManagedChildProcess | null = null;
  private childUsesProcessGroup = false;
  private childOutputTail = "";
  private status: ServerStatus;

  constructor(options: ServerManagerOptions) {
    super();
    this.repoRoot = options.repoRoot;
    this.runtimeRoot = options.runtimeRoot ?? null;
    this.dataDir = options.dataDir;
    this.packaged = options.packaged;
    this.port = options.port ?? SERVER_PORT;
    this.controlPlane = options.controlPlane ?? {};
    this.desktopAuthToken = randomBytes(32).toString("hex");
    this.status = {
      state: "stopped",
      pid: null,
      port: this.port,
    };
  }

  getStatus(): ServerStatus {
    return { ...this.status };
  }

  getControlPlaneConfig(): ControlPlaneConfig {
    return { ...this.controlPlane };
  }

  getDesktopAuthToken(): string {
    return this.desktopAuthToken;
  }

  getDashboardUrl(): string {
    return `http://127.0.0.1:${this.port}/?desktop_token=${encodeURIComponent(this.desktopAuthToken)}`;
  }

  updateControlPlaneConfig(next: ControlPlaneConfig): void {
    this.controlPlane = { ...next };
  }

  async start(): Promise<ServerStatus> {
    if (this.status.state === "running" || this.status.state === "starting") {
      return this.getStatus();
    }

    const launchConfig = this.createLaunchConfig();

    try {
      if (this.packaged) {
        await access(launchConfig.args[0] ?? "");
      }
    } catch {
      this.updateStatus({
        state: "error",
        pid: null,
        port: this.port,
        message: `Server entry not found: ${launchConfig.args[0] ?? "unknown"}`,
      });
      return this.getStatus();
    }

    this.updateStatus({
      state: "starting",
      pid: null,
      port: this.port,
      message: "Starting server...",
    });

    const child: ManagedChildProcess = spawn(
      launchConfig.command,
      launchConfig.args,
      {
        cwd: launchConfig.cwd,
        env: launchConfig.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      },
    );

    this.child = child;
    this.childUsesProcessGroup = process.platform !== "win32";
    this.childOutputTail = "";

    child.stdout.on("data", (chunk) => {
      this.recordChildOutput("stdout", chunk);
      process.stdout.write(`[desktop-electron][server] ${chunk}`);
    });

    child.stderr.on("data", (chunk) => {
      this.recordChildOutput("stderr", chunk);
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
      this.childUsesProcessGroup = false;
      this.updateStatus({
        state: "error",
        pid: null,
        port: this.port,
        message: error.message,
      });
    });

    child.once("exit", (code, signal) => {
      this.child = null;
      this.childUsesProcessGroup = false;
      const wasStopping = this.status.state === "stopping";
      const outputTail = this.childOutputTail.trim();
      const message = wasStopping
        ? "Server stopped"
        : [
            `Server exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`,
            outputTail ? `Recent server output:\n${outputTail}` : "",
          ]
            .filter(Boolean)
            .join("\n\n");

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

    this.killManagedProcess("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.child) {
          this.killManagedProcess("SIGKILL");
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

  private recordChildOutput(streamName: "stdout" | "stderr", chunk: unknown) {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf-8")
      : String(chunk);
    this.childOutputTail = `${this.childOutputTail}[${streamName}] ${text}`;
    if (this.childOutputTail.length > OUTPUT_TAIL_LIMIT) {
      this.childOutputTail = this.childOutputTail.slice(-OUTPUT_TAIL_LIMIT);
    }
  }

  private killManagedProcess(signal: NodeJS.Signals): void {
    if (!this.child?.pid) {
      return;
    }

    try {
      if (this.childUsesProcessGroup) {
        process.kill(-this.child.pid, signal);
        return;
      }
    } catch {
      // Fall back to the direct child kill below.
    }

    this.child.kill(signal);
  }

  private createLaunchConfig(): LaunchConfig {
    const sharedEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(this.port),
      HOST: "0.0.0.0",
      CLI_HOST_OVERRIDE: "true",
      MAINTENANCE_PORT: String(this.port + 1),
      VITE_PORT: String(this.port + 2),
      VITE_STRICT_PORT: "true",
      VITE_HOST: "127.0.0.1",
      AGENTLINE_DATA_DIR: this.dataDir,
      DESKTOP_AUTH_TOKEN: this.desktopAuthToken,
      OPEN_BROWSER: "false",
      CONTROL_PLANE_DESKTOP_MANAGED: "true",
      ...(this.controlPlane.baseUrl
        ? { CONTROL_PLANE_BASE_URL: this.controlPlane.baseUrl }
        : {}),
      ...(this.controlPlane.accessToken
        ? { CONTROL_PLANE_ACCESS_TOKEN: this.controlPlane.accessToken }
        : {}),
      ...(this.controlPlane.relayWsUrl
        ? { CONTROL_PLANE_RELAY_WS_URL: this.controlPlane.relayWsUrl }
        : {}),
      ...(this.controlPlane.deviceName
        ? { CONTROL_PLANE_DEVICE_NAME: this.controlPlane.deviceName }
        : {}),
      ...(this.controlPlane.deviceType
        ? { CONTROL_PLANE_DEVICE_TYPE: this.controlPlane.deviceType }
        : {}),
      ...(this.controlPlane.heartbeatIntervalMs
        ? {
            CONTROL_PLANE_HEARTBEAT_INTERVAL_MS: String(
              this.controlPlane.heartbeatIntervalMs,
            ),
          }
        : {}),
    };

    if (this.packaged) {
      const serverEntry = path.join(this.runtimeRoot ?? "", "dist/index.js");
      const embeddedNodeCommand = this.getEmbeddedNodeCommand();
      return {
        command: embeddedNodeCommand ?? process.execPath,
        args: [serverEntry],
        cwd: this.runtimeRoot ?? this.repoRoot,
        env: {
          ...sharedEnv,
          NODE_ENV: "production",
          ...(embeddedNodeCommand ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
        },
      };
    }

    return {
      command: process.execPath,
      args: [path.join(this.repoRoot, "scripts/dev.js")],
      cwd: this.repoRoot,
      env: {
        ...sharedEnv,
        NODE_ENV: "development",
      },
    };
  }

  private getEmbeddedNodeCommand(): string | null {
    if (!this.runtimeRoot) {
      return null;
    }

    const executableName = process.platform === "win32" ? "node.exe" : "node";
    const candidate = path.resolve(
      this.runtimeRoot,
      "..",
      "node",
      executableName,
    );
    return existsSync(candidate) ? candidate : null;
  }
}
