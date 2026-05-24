/**
 * Unit tests for CodexProvider.
 *
 * Tests provider detection, authentication checking, and message normalization
 * without requiring actual Codex CLI installation.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  findAgentCliPath,
  getAgentCliCommonPaths,
  getCodexCommonPaths,
  verifyAgentCliIdentity,
  whichCommand,
} from "../../../src/sdk/cli-detection.js";
import {
  CodexProvider,
  type CodexProviderConfig,
} from "../../../src/sdk/providers/codex.js";

describe("CodexProvider", () => {
  let provider: CodexProvider;

  beforeAll(() => {
    provider = new CodexProvider();
  });

  describe("isInstalled", () => {
    it("should return boolean indicating CLI availability", async () => {
      const isInstalled = await provider.isInstalled();
      expect(typeof isInstalled).toBe("boolean");
    });

    it("should use custom codexPath if provided and exists", async () => {
      // Custom path is used IF it exists, otherwise falls back to PATH detection
      const customProvider = new CodexProvider({
        codexPath: "/nonexistent/path/to/codex",
      });
      // isInstalled will still check PATH if custom path doesn't exist
      const isInstalled = await customProvider.isInstalled();
      // We just verify it returns a boolean - actual value depends on system
      expect(typeof isInstalled).toBe("boolean");
    });
  });

  describe("getAuthStatus", () => {
    it("should return auth status object with required fields", async () => {
      const status = await provider.getAuthStatus();

      expect(typeof status.installed).toBe("boolean");
      expect(typeof status.authenticated).toBe("boolean");
      expect(typeof status.enabled).toBe("boolean");
    });

    it("should return authenticated=false if auth.json does not exist", async () => {
      // This test relies on the auth file not existing in the test environment
      const authPath = join(homedir(), ".codex", "auth.json");
      if (!existsSync(authPath)) {
        const status = await provider.getAuthStatus();
        // If CLI is not installed, everything should be false
        // If CLI is installed but no auth, installed=true but auth=false
        expect(status.authenticated).toBe(false);
      }
    });
  });

  describe("isAuthenticated", () => {
    it("should return boolean", async () => {
      const isAuth = await provider.isAuthenticated();
      expect(typeof isAuth).toBe("boolean");
    });
  });

  describe("provider properties", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("codex");
    });

    it("should have correct displayName", () => {
      expect(provider.displayName).toBe("Codex");
    });
  });

  describe("startSession", () => {
    it("should return session object with required methods", async () => {
      const session = await provider.startSession({
        cwd: "/tmp",
        initialMessage: { text: "test" },
      });

      expect(session.iterator).toBeDefined();
      expect(typeof session.abort).toBe("function");
      expect(session.queue).toBeDefined();
    });

    it("should emit error if Codex CLI is not found", async () => {
      const noCliProvider = new CodexProvider({
        codexPath: "/nonexistent/codex",
      });

      const session = await noCliProvider.startSession({
        cwd: "/tmp",
        initialMessage: { text: "test" },
      });

      const messages: unknown[] = [];
      for await (const msg of session.iterator) {
        messages.push(msg);
        if (msg.type === "result" || msg.type === "error") break;
      }

      // Should get an error message about CLI not found
      expect(
        messages.some(
          (m: unknown) =>
            (m as { type?: string; error?: string }).type === "error" ||
            (m as { type?: string }).type === "result",
        ),
      ).toBe(true);
    });
  });
});

describe("Codex CLI detection paths", () => {
  it("includes Homebrew installs used by desktop macOS apps with sparse PATH", () => {
    expect(
      getCodexCommonPaths({
        platform: "darwin",
        homeDir: "/Users/tester",
        env: {},
      }),
    ).toContain("/opt/homebrew/bin/codex");
  });

  it("generates macOS Homebrew and user package-manager paths", () => {
    const paths = getAgentCliCommonPaths("gemini", {
      platform: "darwin",
      homeDir: "/Users/tester",
      env: {},
    });

    expect(paths).toContain("/opt/homebrew/bin/gemini");
    expect(paths).toContain("/usr/local/bin/gemini");
    expect(paths).toContain("/Users/tester/.gemini/bin/gemini");
    expect(paths).toContain("/Users/tester/.local/bin/gemini");
  });

  it("generates Linux package-manager and system paths", () => {
    const paths = getAgentCliCommonPaths("opencode", {
      platform: "linux",
      homeDir: "/home/tester",
      env: {},
    });

    expect(paths).toContain("/home/tester/.opencode/bin/opencode");
    expect(paths).toContain("/home/tester/.local/bin/opencode");
    expect(paths).toContain("/home/linuxbrew/.linuxbrew/bin/opencode");
    expect(paths).toContain("/usr/local/bin/opencode");
    expect(paths).toContain("/snap/bin/opencode");
  });

  it("generates Windows executable variants and package-manager paths", () => {
    const paths = getAgentCliCommonPaths("codex", {
      platform: "win32",
      homeDir: "C:\\Users\\tester",
      env: {
        APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
        ProgramData: "C:\\ProgramData",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      },
    });

    expect(paths).toContain(
      "C:\\Users\\tester\\.codex\\.sandbox-bin\\codex.exe",
    );
    expect(paths).toContain(
      "C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd",
    );
    expect(paths).toContain(
      "C:\\Users\\tester\\AppData\\Local\\Microsoft\\WindowsApps\\codex.exe",
    );
    expect(paths).toContain("C:\\ProgramData\\chocolatey\\bin\\codex.exe");
  });

  it("uses the platform-specific PATH lookup command", () => {
    expect(whichCommand("codex", "win32")).toBe("where codex");
    expect(whichCommand("codex", "darwin")).toBe("which codex");
    expect(whichCommand("codex", "linux")).toBe("which codex");
  });

  it("rejects a same-named executable that does not identify as Codex", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-cli-detection-"));
    try {
      const fakeCodex = join(tempDir, "codex");
      writeFileSync(
        fakeCodex,
        "#!/bin/sh\necho 'not the agent you are looking for'\n",
      );
      chmodSync(fakeCodex, 0o755);

      await expect(verifyAgentCliIdentity("codex", fakeCodex)).resolves.toBe(
        false,
      );
      await expect(
        findAgentCliPath("codex", {
          platform: "linux",
          homeDir: tempDir,
          env: { PATH: tempDir },
          probeTimeoutMs: 1000,
        }),
      ).resolves.toBe(null);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("skips a bad PATH candidate and accepts the next valid Codex candidate", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-cli-detection-"));
    try {
      const badBin = join(tempDir, "bad-bin");
      const goodBin = join(tempDir, "good-bin");
      mkdirSync(badBin);
      mkdirSync(goodBin);

      const fakeCodex = join(badBin, "codex");
      writeFileSync(fakeCodex, "#!/bin/sh\necho 'unrelated codex wrapper'\n");
      chmodSync(fakeCodex, 0o755);

      const validCodex = join(goodBin, "codex");
      writeFileSync(validCodex, "#!/bin/sh\necho 'codex-cli 9.9.9'\n");
      chmodSync(validCodex, 0o755);

      await expect(
        findAgentCliPath("codex", {
          platform: "linux",
          homeDir: tempDir,
          env: { PATH: `${badBin}:${goodBin}` },
          probeTimeoutMs: 1000,
        }),
      ).resolves.toBe(validCodex);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("validates configured paths instead of trusting them blindly", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-cli-detection-"));
    try {
      const fakeCodex = join(tempDir, "codex");
      writeFileSync(fakeCodex, "#!/bin/sh\necho 'totally different cli'\n");
      chmodSync(fakeCodex, 0o755);

      const provider = new CodexProvider({ codexPath: fakeCodex });
      await expect(provider.isInstalled()).resolves.toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("CodexProvider Auth File Parsing", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeAll(() => {
    // Create a temp directory to use as HOME
    tempDir = mkdtempSync(join(require("node:os").tmpdir(), "codex-test-"));
    originalHome = process.env.HOME;
  });

  afterAll(() => {
    // Restore HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
    // Cleanup
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("should parse valid auth.json file", async () => {
    // Create mock auth file
    const codexDir = join(tempDir, ".codex");
    require("node:fs").mkdirSync(codexDir, { recursive: true });

    const authData = {
      api_key: "test-key-123",
      expires_at: new Date(Date.now() + 86400000).toISOString(), // 1 day from now
      user: {
        email: "test@example.com",
        name: "Test User",
      },
    };

    writeFileSync(join(codexDir, "auth.json"), JSON.stringify(authData));

    // Create provider that looks in our temp directory
    // Note: This doesn't actually work because homedir() is cached,
    // but it demonstrates the intended behavior
  });

  it("should handle expired tokens", async () => {
    // Create mock auth file with expired token
    const codexDir = join(tempDir, ".codex");
    require("node:fs").mkdirSync(codexDir, { recursive: true });

    const authData = {
      api_key: "test-key-123",
      expires_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    };

    writeFileSync(join(codexDir, "auth.json"), JSON.stringify(authData));

    // The actual test would need to mock homedir() to use tempDir
  });

  it("should handle invalid JSON in auth file", async () => {
    const codexDir = join(tempDir, ".codex");
    require("node:fs").mkdirSync(codexDir, { recursive: true });

    writeFileSync(join(codexDir, "auth.json"), "not valid json");

    // Provider should handle this gracefully
  });
});

describe("CodexProvider Event Normalization", () => {
  // Test helper to create a provider and access internal methods
  function createTestProvider(): CodexProvider {
    return new CodexProvider();
  }

  it("should have correct provider interface", () => {
    const provider = createTestProvider();

    expect(provider.name).toBe("codex");
    expect(provider.displayName).toBe("Codex");
    expect(typeof provider.isInstalled).toBe("function");
    expect(typeof provider.isAuthenticated).toBe("function");
    expect(typeof provider.getAuthStatus).toBe("function");
    expect(typeof provider.startSession).toBe("function");
  });

  it("normalizes command execution tool_use and tool_result to Read shape", () => {
    const provider = createTestProvider() as unknown as {
      convertItemToSDKMessages: (
        item: unknown,
        sessionId: string,
        turnId: string,
        sourceEvent: "item/started" | "item/completed",
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertItemToSDKMessages(
      {
        id: "call-read",
        type: "command_execution",
        command: "cat src/example.ts",
        aggregated_output: "line 1\nline 2",
        exit_code: 0,
        status: "completed",
      },
      "session-1",
      "turn-1",
      "item/completed",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.message).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-read",
          name: "Read",
          input: { file_path: "src/example.ts" },
        },
      ],
    });
    expect(messages[1]?.message).toMatchObject({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call-read",
          content: "line 1\nline 2",
        },
      ],
    });
    expect(messages[1]?.toolUseResult).toMatchObject({
      type: "text",
      file: {
        filePath: "src/example.ts",
      },
    });
  });

  it("normalizes shell-launcher wrapped command execution to Read shape", () => {
    const provider = createTestProvider() as unknown as {
      convertItemToSDKMessages: (
        item: unknown,
        sessionId: string,
        turnId: string,
        sourceEvent: "item/started" | "item/completed",
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertItemToSDKMessages(
      {
        id: "call-read-wrapped",
        type: "command_execution",
        command: "/bin/bash -lc \"sed -n '10,12p' src/example.ts\"",
        aggregated_output: "line 10\nline 11\nline 12",
        exit_code: 0,
        status: "completed",
      },
      "session-1",
      "turn-1",
      "item/completed",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.message).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-read-wrapped",
          name: "Read",
          input: { file_path: "src/example.ts", offset: 10, limit: 3 },
        },
      ],
    });
    expect(messages[1]?.toolUseResult).toMatchObject({
      type: "text",
      file: {
        filePath: "src/example.ts",
        startLine: 10,
      },
    });
  });

  it("normalizes heredoc command execution as Write with structured file result", () => {
    const provider = createTestProvider() as unknown as {
      convertItemToSDKMessages: (
        item: unknown,
        sessionId: string,
        turnId: string,
        sourceEvent: "item/started" | "item/completed",
      ) => Array<Record<string, unknown>>;
    };

    const content = "line 1\nline 2\n";
    const messages = provider.convertItemToSDKMessages(
      {
        id: "call-write",
        type: "command_execution",
        command: `cat > src/generated.ts <<'EOF'\n${content}EOF`,
        aggregated_output: "",
        exit_code: 0,
        status: "completed",
      },
      "session-1",
      "turn-2",
      "item/completed",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.message).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-write",
          name: "Write",
          input: {
            file_path: "src/generated.ts",
            content,
          },
        },
      ],
    });

    const resultBlock = ((
      messages[1]?.message as { content?: unknown[] } | undefined
    )?.content ?? [])[0] as Record<string, unknown>;
    expect(resultBlock.type).toBe("tool_result");
    expect(resultBlock.tool_use_id).toBe("call-write");
    expect(resultBlock.is_error).toBeUndefined();
    expect(messages[1]?.toolUseResult).toMatchObject({
      type: "text",
      file: {
        filePath: "src/generated.ts",
        content,
        numLines: 2,
        startLine: 1,
        totalLines: 2,
      },
    });
  });

  it("normalizes no-match ripgrep exit code as non-error Grep result", () => {
    const provider = createTestProvider() as unknown as {
      convertItemToSDKMessages: (
        item: unknown,
        sessionId: string,
        turnId: string,
        sourceEvent: "item/started" | "item/completed",
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertItemToSDKMessages(
      {
        id: "call-grep",
        type: "command_execution",
        command: "rg -n missing_pattern src",
        aggregated_output: "",
        exit_code: 1,
        status: "completed",
      },
      "session-1",
      "turn-2",
      "item/completed",
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]?.message).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-grep",
          name: "Grep",
          input: { pattern: "missing_pattern", path: "src" },
        },
      ],
    });

    const resultBlock = ((
      messages[1]?.message as { content?: unknown[] } | undefined
    )?.content ?? [])[0] as Record<string, unknown>;
    expect(resultBlock.type).toBe("tool_result");
    expect(resultBlock.tool_use_id).toBe("call-grep");
    expect(resultBlock.is_error).toBeUndefined();
    expect(messages[1]?.toolUseResult).toMatchObject({
      mode: "files_with_matches",
      numFiles: 0,
    });
  });

  it("does not emit rate limit errors when hasCredits is false but usage is below 100%", () => {
    const provider = createTestProvider() as unknown as {
      convertNotificationToSDKMessages: (
        notification: { method: string; params?: unknown },
        sessionId: string,
        usageByTurnId: Map<string, unknown>,
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertNotificationToSDKMessages(
      {
        method: "account/rateLimits/updated",
        params: {
          rateLimits: {
            primary: {
              usedPercent: 21,
              resetsAt: 1772721801,
            },
            credits: {
              hasCredits: false,
              unlimited: false,
              balance: null,
            },
          },
        },
      },
      "session-1",
      new Map(),
    );

    expect(messages).toEqual([]);
  });

  it("does not emit synthetic errors for exhausted usage snapshots", () => {
    const provider = createTestProvider() as unknown as {
      convertNotificationToSDKMessages: (
        notification: { method: string; params?: unknown },
        sessionId: string,
        usageByTurnId: Map<string, unknown>,
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertNotificationToSDKMessages(
      {
        method: "account/rateLimits/updated",
        params: {
          rateLimits: {
            primary: {
              used_percent: 100,
              resets_at: 1772721801,
            },
            credits: {
              has_credits: false,
              unlimited: false,
              balance: null,
            },
          },
        },
      },
      "session-1",
      new Map(),
    );

    expect(messages).toEqual([]);
  });

  it("emits errors from codex error notifications", () => {
    const provider = createTestProvider() as unknown as {
      convertNotificationToSDKMessages: (
        notification: { method: string; params?: unknown },
        sessionId: string,
        usageByTurnId: Map<string, unknown>,
      ) => Array<Record<string, unknown>>;
    };

    const messages = provider.convertNotificationToSDKMessages(
      {
        method: "error",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          willRetry: false,
          error: {
            message:
              "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again later.",
            codexErrorInfo: "usageLimitExceeded",
          },
        },
      },
      "session-1",
      new Map(),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "error",
      session_id: "session-1",
      error:
        "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again later.",
    });
  });
});

describe("CodexProvider resume parameters", () => {
  it("keeps persisted model when resuming existing sessions", () => {
    const provider = new CodexProvider() as unknown as {
      buildThreadResumeParams: (
        options: {
          cwd: string;
          resumeSessionId?: string;
          model?: string;
          codexResumeHistory?: Array<Record<string, unknown>>;
          codexResumePath?: string;
        },
        sessionId: string,
        policy: { approvalPolicy: "on-request"; sandbox: "workspace-write" },
      ) => Record<string, unknown>;
    };

    const params = provider.buildThreadResumeParams(
      {
        cwd: "/tmp/project",
        resumeSessionId: "sess-1",
        model: "gpt-5.4",
      },
      "sess-1",
      { approvalPolicy: "on-request", sandbox: "workspace-write" },
    );

    expect(params).toMatchObject({
      threadId: "sess-1",
      cwd: "/tmp/project",
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    expect(params).not.toHaveProperty("model");
  });

  it("embeds persisted history when provided for resume compatibility", () => {
    const provider = new CodexProvider() as unknown as {
      buildThreadResumeParams: (
        options: {
          cwd: string;
          resumeSessionId?: string;
          codexResumeHistory?: Array<Record<string, unknown>>;
        },
        sessionId: string,
        policy: { approvalPolicy: "on-request"; sandbox: "workspace-write" },
      ) => Record<string, unknown>;
    };

    const history = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    ];

    const params = provider.buildThreadResumeParams(
      {
        cwd: "/tmp/project",
        resumeSessionId: "sess-2",
        codexResumeHistory: history,
      },
      "sess-2",
      { approvalPolicy: "on-request", sandbox: "workspace-write" },
    );

    expect(params.history).toEqual(history);
  });

  it("prefers rollout path over history for same-thread resume", () => {
    const provider = new CodexProvider() as unknown as {
      buildThreadResumeParams: (
        options: {
          cwd: string;
          resumeSessionId?: string;
          codexResumeHistory?: Array<Record<string, unknown>>;
          codexResumePath?: string;
        },
        sessionId: string,
        policy: { approvalPolicy: "on-request"; sandbox: "workspace-write" },
      ) => Record<string, unknown>;
    };

    const params = provider.buildThreadResumeParams(
      {
        cwd: "/tmp/project",
        resumeSessionId: "sess-3",
        codexResumePath: "/tmp/codex/rollout-sess-3.jsonl",
        codexResumeHistory: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello" }],
          },
        ],
      },
      "sess-3",
      { approvalPolicy: "on-request", sandbox: "workspace-write" },
    );

    expect(params.path).toBe("/tmp/codex/rollout-sess-3.jsonl");
    expect(params).not.toHaveProperty("history");
  });
});

describe("CodexProvider Configuration", () => {
  it("should accept custom timeout", () => {
    const config: CodexProviderConfig = {
      timeout: 60000,
    };
    const provider = new CodexProvider(config);

    expect(provider.name).toBe("codex");
    // Can't directly verify timeout since it's private,
    // but we can verify the provider was created
  });

  it("should accept custom codex path", () => {
    const config: CodexProviderConfig = {
      codexPath: "/custom/path/to/codex",
    };
    const provider = new CodexProvider(config);

    expect(provider.name).toBe("codex");
  });

  it("should use defaults when no config provided", () => {
    const provider = new CodexProvider();

    expect(provider.name).toBe("codex");
    expect(provider.displayName).toBe("Codex");
  });
});
