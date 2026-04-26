/**
 * File path detection utility.
 *
 * Re-exports from shared package for backward compatibility.
 * The actual implementation lives in @agentline/shared.
 */

// Re-export everything from shared
export {
  type DetectedFilePath,
  type TextSegment,
  isLikelyFilePath,
  parseLineColumn,
  detectFilePaths,
  splitTextWithFilePaths,
  transformFilePathsToHtml,
} from "@agentline/shared";
