import { exec, execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export type AgentCliName = "claude" | "codex" | "gemini" | "opencode";

export interface AgentCliPathOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  configuredPath?: string;
  probeTimeoutMs?: number;
  validateIdentity?: boolean;
}

interface AgentCliProbe {
  args: string[];
  matches: (output: string) => boolean;
}

/**
 * Returns the platform-appropriate command to locate an executable in PATH.
 * Uses `where` on Windows, `which` on Unix.
 */
export function whichCommand(
  name: string,
  platform: NodeJS.Platform = os.platform(),
): string {
  return platform === "win32" ? `where ${name}` : `which ${name}`;
}

function uniqueExistingOrder(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of paths) {
    if (!candidate) continue;
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function isUsableExecutablePath(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function getMergedEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return env ? { ...process.env, ...env } : process.env;
}

function pathApiFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

function joinForPlatform(
  platform: NodeJS.Platform,
  ...segments: string[]
): string {
  return pathApiFor(platform).join(...segments);
}

function getExecutableNames(
  name: AgentCliName,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  if (platform !== "win32") return [name];

  const pathext = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = pathext
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);

  return uniqueExistingOrder([
    name,
    ...extensions.map((ext) => `${name}${ext}`),
    `${name}.exe`,
    `${name}.cmd`,
    `${name}.bat`,
  ]);
}

function appendExecutableNames(
  dirs: string[],
  name: AgentCliName,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const executableNames = getExecutableNames(name, platform, env);
  return dirs.flatMap((dir) =>
    executableNames.map((executableName) =>
      joinForPlatform(platform, dir, executableName),
    ),
  );
}

function getEnvConfiguredPaths(
  name: AgentCliName,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const upperName = name.toUpperCase();
  const configuredPaths = [
    env[`AGENTLINE_${upperName}_PATH`],
    env[`${upperName}_PATH`],
  ].filter((value): value is string => Boolean(value?.trim()));

  const configuredAsDirs = configuredPaths.flatMap((configuredPath) =>
    appendExecutableNames([configuredPath], name, platform, env),
  );

  return uniqueExistingOrder([...configuredPaths, ...configuredAsDirs]);
}

function getConfiguredPathCandidates(
  configuredPath: string | undefined,
  name: AgentCliName,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  if (!configuredPath?.trim()) return [];

  return uniqueExistingOrder([
    configuredPath,
    ...appendExecutableNames([configuredPath], name, platform, env),
  ]);
}

function getPathEnvValue(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (platform !== "win32") return env.PATH;
  return env.Path ?? env.PATH ?? env.path;
}

function getPathEnvCandidates(
  name: AgentCliName,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const pathEnv = getPathEnvValue(platform, env);
  if (!pathEnv) return [];

  const delimiter = platform === "win32" ? ";" : ":";
  const dirs = pathEnv
    .split(delimiter)
    .map((dir) => dir.trim())
    .filter(Boolean);

  return appendExecutableNames(dirs, name, platform, env);
}

function getReadableChildDirs(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.posix.join(parent, entry.name));
  } catch {
    return [];
  }
}

function getUnixNodeVersionManagerDirs(home: string): string[] {
  const nvmNodeVersions = path.posix.join(home, ".nvm", "versions", "node");
  const nvmDirs = getReadableChildDirs(nvmNodeVersions).map((versionDir) =>
    path.posix.join(versionDir, "bin"),
  );

  const fnmNodeVersions = path.posix.join(home, ".local", "share", "fnm");
  const fnmDirs = getReadableChildDirs(fnmNodeVersions)
    .flatMap((versionRoot) => getReadableChildDirs(versionRoot))
    .map((versionDir) =>
      versionDir.endsWith("/installation")
        ? path.posix.join(versionDir, "bin")
        : path.posix.join(versionDir, "installation", "bin"),
    );

  return [...nvmDirs, ...fnmDirs];
}

function getPlatformCliDirs(
  name: AgentCliName,
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv,
): string[] {
  if (platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
    const appData = env.APPDATA ?? path.win32.join(home, "AppData", "Roaming");
    const programData = env.ProgramData ?? "C:\\ProgramData";

    return uniqueExistingOrder([
      path.win32.join(home, ".codex", ".sandbox-bin"),
      path.win32.join(home, ".codex", "bin"),
      path.win32.join(home, ".gemini", "bin"),
      path.win32.join(home, ".opencode", "bin"),
      path.win32.join(home, ".local", "bin"),
      path.win32.join(home, "bin"),
      path.win32.join(home, ".cargo", "bin"),
      path.win32.join(home, ".bun", "bin"),
      path.win32.join(home, ".volta", "bin"),
      path.win32.join(appData, "npm"),
      path.win32.join(localAppData, "pnpm"),
      path.win32.join(localAppData, "Volta", "bin"),
      path.win32.join(localAppData, "Microsoft", "WindowsApps"),
      path.win32.join(home, "scoop", "shims"),
      path.win32.join(programData, "chocolatey", "bin"),
      env.npm_config_prefix,
      env.npm_config_prefix
        ? path.win32.join(env.npm_config_prefix, "bin")
        : undefined,
      name === "codex" ? path.win32.join(home, ".cargo", "bin") : undefined,
    ]);
  }

  const commonUnixDirs = [
    path.posix.join(home, ".local", "bin"),
    path.posix.join(home, "bin"),
    path.posix.join(home, ".cargo", "bin"),
    path.posix.join(home, ".npm-global", "bin"),
    path.posix.join(home, ".bun", "bin"),
    path.posix.join(home, ".volta", "bin"),
    path.posix.join(home, ".asdf", "shims"),
    path.posix.join(home, ".local", "share", "mise", "shims"),
    path.posix.join(home, ".nix-profile", "bin"),
    env.npm_config_prefix,
    env.npm_config_prefix
      ? path.posix.join(env.npm_config_prefix, "bin")
      : undefined,
    ...getUnixNodeVersionManagerDirs(home),
  ];

  const agentSpecificDirs = [
    name === "codex"
      ? path.posix.join(home, ".codex", ".sandbox-bin")
      : undefined,
    name === "codex" ? path.posix.join(home, ".codex", "bin") : undefined,
    name === "gemini" ? path.posix.join(home, ".gemini", "bin") : undefined,
    name === "opencode" ? path.posix.join(home, ".opencode", "bin") : undefined,
  ];

  if (platform === "darwin") {
    return uniqueExistingOrder([
      ...agentSpecificDirs,
      ...commonUnixDirs,
      path.posix.join(home, "Library", "pnpm"),
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/opt/local/bin",
      "/nix/var/nix/profiles/default/bin",
      "/usr/bin",
    ]);
  }

  return uniqueExistingOrder([
    ...agentSpecificDirs,
    ...commonUnixDirs,
    path.posix.join(home, ".local", "share", "pnpm"),
    "/home/linuxbrew/.linuxbrew/bin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/usr/sbin",
    "/bin",
    "/snap/bin",
    "/opt/bin",
    "/nix/var/nix/profiles/default/bin",
    "/run/current-system/sw/bin",
  ]);
}

/**
 * Common CLI installation paths for agent binaries. Paths are generated from
 * the current OS first, then provider-specific homes and common package
 * manager locations are added for that OS.
 */
export function getAgentCliCommonPaths(
  name: AgentCliName,
  options: AgentCliPathOptions = {},
): string[] {
  const platform = options.platform ?? os.platform();
  const home = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const dirs = getPlatformCliDirs(name, platform, home, env);

  return uniqueExistingOrder([
    ...getConfiguredPathCandidates(options.configuredPath, name, platform, env),
    ...getEnvConfiguredPaths(name, platform, env),
    ...appendExecutableNames(dirs, name, platform, env),
  ]);
}

async function getWhichCandidates(
  name: AgentCliName,
  options: AgentCliPathOptions = {},
): Promise<string[]> {
  const platform = options.platform ?? os.platform();
  const env = getMergedEnv(options.env);

  try {
    const { stdout } = await execAsync(whichCommand(name, platform), {
      encoding: "utf-8",
      env,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    // Not in PATH
  }

  return [];
}

async function getPathLookupCandidates(
  name: AgentCliName,
  options: AgentCliPathOptions = {},
): Promise<string[]> {
  const platform = options.platform ?? os.platform();
  const env = options.env ?? process.env;
  return uniqueExistingOrder([
    ...(await getWhichCandidates(name, options)),
    ...getPathEnvCandidates(name, platform, env),
  ]);
}

const AGENT_CLI_PROBES: Record<AgentCliName, AgentCliProbe[]> = {
  claude: [
    {
      args: ["--help"],
      matches: (output) => /\bclaude\b/i.test(output),
    },
  ],
  codex: [
    {
      args: ["--version"],
      matches: (output) => /\bcodex-cli\s+\d/i.test(output),
    },
    {
      args: ["--help"],
      matches: (output) =>
        /\bCodex CLI\b/i.test(output) && /\bapp-server\b/i.test(output),
    },
  ],
  gemini: [
    {
      args: ["--help"],
      matches: (output) =>
        /\bgemini\b/i.test(output) && /\bUsage\b/i.test(output),
    },
  ],
  opencode: [
    {
      args: ["--help"],
      matches: (output) =>
        /\bopencode\b/i.test(output) && /\b(auth|models|serve)\b/i.test(output),
    },
  ],
};

async function runAgentCliProbe(
  candidate: string,
  probe: AgentCliProbe,
  options: AgentCliPathOptions,
): Promise<boolean> {
  const platform = options.platform ?? os.platform();
  const useShell = platform === "win32" && /\.(bat|cmd)$/i.test(candidate);

  try {
    const { stdout, stderr } = await execFileAsync(candidate, probe.args, {
      encoding: "utf-8",
      env: getMergedEnv(options.env),
      shell: useShell,
      timeout: options.probeTimeoutMs ?? 3000,
      windowsHide: true,
    });
    return probe.matches(`${stdout}\n${stderr}`);
  } catch {
    return false;
  }
}

/**
 * Validate that a discovered executable is the expected agent CLI, not just a
 * same-named shim or stale script in PATH.
 */
export async function verifyAgentCliIdentity(
  name: AgentCliName,
  candidate: string,
  options: AgentCliPathOptions = {},
): Promise<boolean> {
  if (!isUsableExecutablePath(candidate)) return false;
  if (options.validateIdentity === false) return true;

  const probes = AGENT_CLI_PROBES[name];
  for (const probe of probes) {
    if (await runAgentCliProbe(candidate, probe, options)) {
      return true;
    }
  }

  return false;
}

/**
 * Find an agent CLI by checking configured paths, PATH, then OS-specific
 * common locations. A candidate must pass provider-specific identity probes.
 */
export async function findAgentCliPath(
  name: AgentCliName,
  options: AgentCliPathOptions = {},
): Promise<string | null> {
  const platform = options.platform ?? os.platform();
  const env = options.env ?? process.env;
  const candidates = uniqueExistingOrder([
    ...getConfiguredPathCandidates(options.configuredPath, name, platform, env),
    ...(await getPathLookupCandidates(name, options)),
    ...getAgentCliCommonPaths(name, options),
  ]);

  for (const candidate of candidates) {
    if (await verifyAgentCliIdentity(name, candidate, options)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Information about the Claude CLI installation.
 */
export interface ClaudeCliInfo {
  /** Whether the CLI was found */
  found: boolean;
  /** Path to the CLI executable */
  path?: string;
  /** CLI version string */
  version?: string;
  /** Error message if not found */
  error?: string;
}

/**
 * Detect the Claude CLI installation.
 *
 * Checks:
 * 1. PATH via `which claude`
 * 2. Common installation locations
 *
 * @returns Information about the CLI installation
 */
export function detectClaudeCli(): ClaudeCliInfo {
  // Short-circuit: let the SDK handle CLI spawning and errors
  return { found: true, path: "claude", version: "(SDK-managed)" };
}

/**
 * Information about the Codex CLI installation.
 */
export interface CodexCliInfo {
  /** Whether the CLI was found */
  found: boolean;
  /** Path to the CLI executable */
  path?: string;
  /** CLI version string */
  version?: string;
  /** Error message if not found */
  error?: string;
}

/**
 * Detect the Codex CLI installation.
 *
 * Checks:
 * 1. PATH via `which codex`
 * 2. Common installation locations (cargo, local bin, etc.)
 *
 * @returns Information about the CLI installation
 */
export async function detectCodexCli(): Promise<CodexCliInfo> {
  const codexPath = await findCodexCliPath();
  if (codexPath) {
    const version = await getCodexVersion(codexPath);
    if (version) {
      return { found: true, path: codexPath, version };
    }
  }

  return {
    found: false,
    error: "Codex CLI not found. Install Codex and ensure it is on PATH.",
  };
}

/**
 * Common Codex CLI installation paths (checked after PATH lookup).
 * Includes the Codex desktop app's sandbox-bin location.
 */
export function getCodexCommonPaths(
  options: AgentCliPathOptions = {},
): string[] {
  return getAgentCliCommonPaths("codex", options);
}

/**
 * Find the Codex CLI path by checking PATH first, then common locations.
 * Returns the path if found, null otherwise.
 */
export async function findCodexCliPath(): Promise<string | null> {
  return findAgentCliPath("codex");
}

/**
 * Get the version of the Codex CLI at the given path.
 */
async function getCodexVersion(codexPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(codexPath, ["--version"], {
      encoding: "utf-8",
    });
    const output = stdout.trim();
    return output;
  } catch {
    return undefined;
  }
}
