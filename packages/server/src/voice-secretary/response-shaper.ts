import type { TalkerBrief } from "./types.js";

const MAX_SUMMARY_CHARS = 140;
const MAX_QUESTION_CHARS = 48;

function cleanWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizePunctuation(text: string): string {
  return text.replace(/\s*([，。！？；：,.!?;:])\s*/g, "$1");
}

export function oralizeTalkerText(value: string): string {
  return cleanWhitespace(
    normalizePunctuation(
      value
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/^#+\s*/gm, "")
        .replace(/^\s*[-*]\s+/gm, "")
        .replace(/\/api\/voice-secretary/gi, "语音秘书接口")
        .replace(/packages\/client/gi, "前端页面")
        .replace(/packages\/server/gi, "服务端")
        .replace(/packages\/relay/gi, "中继服务")
        .replace(/docs\/[^\s，。；,]*/gi, "项目文档")
        .replace(/\bASR\b/gi, "语音识别")
        .replace(/\bTTS\b/gi, "语音合成")
        .replace(/\bWorker\b/g, "项目专家")
        .replace(/\bTalker\b/g, "语音秘书")
        .replace(/\bProjectPlanner\b/g, "项目规划器")
        .replace(/[A-Za-z0-9._-]*\/[A-Za-z0-9._/-]+/g, "相关模块"),
    ),
  );
}

function splitSentences(text: string): string[] {
  return (
    oralizeTalkerText(text).match(/[^。！？!?]+[。！？!?]?/g) ?? [
      oralizeTalkerText(text),
    ]
  )
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[。！？!?；;，,]+$/u, "").trim();
}

function ensureSentence(text: string): string {
  const normalized = stripTrailingPunctuation(text);
  return normalized ? `${normalized}。` : "";
}

function ensureQuestion(text: string): string {
  const normalized = stripTrailingPunctuation(text);
  if (!normalized) return "";
  return normalized.endsWith("吗") ||
    normalized.endsWith("呢") ||
    normalized.endsWith("要不要") ||
    normalized.includes("还是")
    ? `${normalized}？`
    : `${normalized}？`;
}

function truncateSoft(text: string, maxChars: number, suffix: string): string {
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars);
  const cutIndex = Math.max(
    sliced.lastIndexOf("。"),
    sliced.lastIndexOf("，"),
    sliced.lastIndexOf("；"),
  );
  const base = cutIndex >= 16 ? sliced.slice(0, cutIndex) : sliced;
  return `${stripTrailingPunctuation(base)}${suffix}`;
}

export function shapeSpokenSummary(text: string): string {
  const sentences = splitSentences(text);
  const concise = sentences.slice(0, 2).join("");
  return ensureSentence(truncateSoft(concise, MAX_SUMMARY_CHARS, "。"));
}

export function shapeSuggestedNextUtterance(text: string): string {
  const normalized = oralizeTalkerText(text)
    .replace(/^下一步/u, "")
    .replace(/^你想/u, "你想")
    .trim();
  return ensureQuestion(truncateSoft(normalized, MAX_QUESTION_CHARS, "？"));
}

export function shapeTalkerBrief(brief: TalkerBrief): TalkerBrief {
  const suggestedNextUtterance = shapeSuggestedNextUtterance(
    brief.suggestedNextUtterance,
  );
  return {
    ...brief,
    spokenSummary: shapeSpokenSummary(brief.spokenSummary),
    suggestedNextUtterance,
    questionsToAsk:
      brief.questionsToAsk.length > 0
        ? brief.questionsToAsk
            .map((item) => shapeSuggestedNextUtterance(item))
            .filter(Boolean)
            .slice(0, 2)
        : [suggestedNextUtterance].filter(Boolean),
  };
}
