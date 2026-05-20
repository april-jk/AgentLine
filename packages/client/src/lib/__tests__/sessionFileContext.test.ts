import { describe, expect, it } from "vitest";
import type { Message } from "../../types";
import {
  deriveSessionFilesPath,
  normalizeSessionFilePath,
} from "../sessionFileContext";

describe("sessionFileContext", () => {
  it("uses the most recent relative file path from session tools", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "src/components/Button.tsx" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-2",
            name: "Edit",
            input: { file_path: "apps/mobile/App.tsx" },
          },
        ],
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    expect(deriveSessionFilesPath(messages, "/repo")).toBe("apps/mobile");
  });

  it("resolves absolute file paths inside the current project", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Write",
            input: { file_path: "/repo/packages/client/src/main.tsx" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    expect(deriveSessionFilesPath(messages, "/repo")).toBe(
      "packages/client/src",
    );
  });

  it("prefers linked file paths attached to write_stdin actions", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "server/src/routes/files.ts" },
          },
          {
            type: "tool_use",
            id: "tool-2",
            name: "WriteStdin",
            input: {
              linked_file_path: "packages/client/src/pages/FilesPage.tsx",
            },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    expect(deriveSessionFilesPath(messages, "/repo")).toBe(
      "packages/client/src/pages",
    );
  });

  it("falls back to project root when no usable file path exists", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "pnpm test" },
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      },
    ];

    expect(deriveSessionFilesPath(messages, "/repo")).toBe(".");
  });

  it("rejects absolute paths outside the current project", () => {
    expect(
      normalizeSessionFilePath("/other/project/file.ts", "/repo"),
    ).toBeNull();
  });
});
