import type { Message } from "../types";
import { preprocessMessages } from "./preprocessMessages";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function normalizeSessionFilePath(
  filePath: string,
  projectPath?: string | null,
): string | null {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\\/g, "/");
  const normalizedProject = projectPath
    ? normalizeProjectPath(projectPath)
    : null;
  const isWindowsAbsolute = /^[a-zA-Z]:\//.test(normalized);
  const isUnixAbsolute = normalized.startsWith("/");
  const isAbsolute = isWindowsAbsolute || isUnixAbsolute;

  let relativePath = normalized;
  if (isAbsolute) {
    if (!normalizedProject) {
      return null;
    }
    if (normalized === normalizedProject) {
      return ".";
    }
    if (!normalized.startsWith(`${normalizedProject}/`)) {
      return null;
    }
    relativePath = normalized.slice(normalizedProject.length + 1);
  }

  relativePath = relativePath.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!relativePath || relativePath === ".") {
    return ".";
  }

  if (
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.includes("/../")
  ) {
    return null;
  }

  return relativePath;
}

export function getDirectoryPath(filePath: string): string {
  if (filePath === ".") {
    return ".";
  }

  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) {
    return ".";
  }

  const directory = filePath.slice(0, lastSlash);
  return directory || ".";
}

function extractFilePathFromToolInput(input: unknown): string | null {
  if (!isRecord(input)) {
    return null;
  }

  const candidates = [input.linked_file_path, input.file_path] as const;

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

export function deriveSessionFilesPath(
  messages: Message[],
  projectPath?: string | null,
): string {
  const items = preprocessMessages(messages);

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type !== "tool_call") {
      continue;
    }

    const rawFilePath = extractFilePathFromToolInput(item.toolInput);
    if (!rawFilePath) {
      continue;
    }

    const normalizedFilePath = normalizeSessionFilePath(
      rawFilePath,
      projectPath,
    );
    if (!normalizedFilePath) {
      continue;
    }

    return getDirectoryPath(normalizedFilePath);
  }

  return ".";
}
